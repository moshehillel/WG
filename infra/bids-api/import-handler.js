/**
 * Scheduled / invoked SESIS import: available bids, then awarded reports.
 * Does not place a bid unless a separate admin action turns live place-bid on.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { runAwardedImport, runCaseImport } from './import-runner.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});
const secrets = new SecretsManagerClient({});

async function loadCredentials() {
  const name = process.env.SESIS_SECRET_NAME || '';
  if (!name) return null;
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: name }));
  const raw = out.SecretString || '';
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const username = String(data.username || data.user || '').trim();
  const password = String(data.password || '');
  if (!username || !password) return null;
  return {
    baseUrl: String(data.baseUrl || data.origin || 'https://sesis.nycenet.edu').trim(),
    workspace: String(data.workspace || 'NYCONFIG').trim(),
    username,
    password,
    placeBid: data.placeBid,
  };
}

export async function handler(event = {}) {
  const mode = event.mode || event.importMode || (event.source === 'fixture' ? 'fixture' : 'live');
  const only = event.only || 'both';
  try {
    const credentials = mode === 'live' ? await loadCredentials() : null;
    if (mode === 'live' && !credentials) {
      return { ok: false, error: 'SESIS secret is missing username or password.' };
    }
    const shared = {
      ddb,
      s3,
      casesTable: process.env.TABLE_CASES,
      bidsTable: process.env.TABLE_BIDS,
      awardsTable: process.env.TABLE_AWARDS,
      providersTable: process.env.TABLE_PROVIDERS,
      unfilledTable: process.env.TABLE_UNFILLED,
      bucket: process.env.DOWNLOADS_BUCKET,
      mode,
      credentials,
      onStep: (step, detail) => console.log('bids-import', step, detail),
    };
    let available = null;
    let awarded = null;
    if (only === 'available' || only === 'both') {
      available = await runCaseImport(shared);
    }
    if (only === 'awarded' || only === 'both') {
      awarded = await runAwardedImport(shared);
    }
    return {
      ok: true,
      mode,
      available: available && {
        source: available.source,
        lastAt: available.lastAt,
        caseCount: available.caseCount,
        written: available.written,
        updated: available.updated,
        withAddress: available.withAddress,
        blankAddress: available.blankAddress,
      },
      awarded: awarded && {
        source: awarded.source,
        lastAt: awarded.lastAt,
        awardedRows: awarded.awardedRows,
        awardsWritten: awarded.awardsWritten,
        casesCreated: awarded.casesCreated,
        confirmed: awarded.confirmed,
        pending: awarded.pending,
      },
    };
  } catch (err) {
    console.error('bids-import', err.name || 'Error', err.message || '');
    return { ok: false, error: err.message || 'Import failed' };
  }
}
