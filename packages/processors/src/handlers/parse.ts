import type { Handler } from 'aws-lambda';
import type { DownloadResult, ParseResult } from '@white-glove/shared';
import {
  DownloadResultSchema,
  getEnv,
  normalizedArtifactKey,
} from '@white-glove/shared';
import {
  parseClosedCases,
  parseOpenedCases,
  parseVerifiedSessions,
} from '../parse-reports.js';
import { filterOpenedCases } from '../rules.js';
import { getObjectText, putJson } from '../s3.js';

export interface ParseEvent {
  download: DownloadResult;
  runId?: string;
}

export const handler: Handler<ParseEvent, ParseResult> = async (event) => {
  const download = DownloadResultSchema.parse(event.download);
  const env = getEnv();
  const bucket = download.bucket || env.REPORTS_BUCKET;
  if (!bucket) throw new Error('REPORTS_BUCKET / download.bucket required');

  const [openedRaw, closedRaw, sessionsRaw] = await Promise.all([
    getObjectText(bucket, download.keys.opened_cases),
    getObjectText(bucket, download.keys.closed_cases),
    getObjectText(bucket, download.keys.verified_sessions),
  ]);

  const opened = parseOpenedCases(openedRaw);
  const closed = parseClosedCases(closedRaw);
  const sessions = parseVerifiedSessions(sessionsRaw);
  const { kept } = filterOpenedCases(opened);

  const artifactKeys = {
    opened_cases: normalizedArtifactKey(download.runId, 'opened_cases'),
    closed_cases: normalizedArtifactKey(download.runId, 'closed_cases'),
    verified_sessions: normalizedArtifactKey(download.runId, 'verified_sessions'),
  };

  await Promise.all([
    putJson(bucket, artifactKeys.opened_cases, kept),
    putJson(bucket, artifactKeys.closed_cases, closed),
    putJson(bucket, artifactKeys.verified_sessions, sessions),
  ]);

  return {
    runId: download.runId,
    counts: {
      opened_cases: opened.length,
      closed_cases: closed.length,
      verified_sessions: sessions.length,
      opened_cases_after_ei_filter: kept.length,
    },
    artifactKeys,
  };
};
