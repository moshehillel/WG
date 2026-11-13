/**
 * SESIS place-bid BASE. Default dry-run.
 * Live only when BIDS_SESIS_PLACE_BID=1 (or secret placeBid=true).
 */

import { SesisClient, fillOpenBidsBodyExport, fillPlaceBidBodyExport } from './sesis-available.js';

export function placeBidEnabled(env = process.env, secret = null) {
  if (String(env.BIDS_SESIS_PLACE_BID || '') === '1') return true;
  if (secret && (secret.placeBid === true || secret.placeBid === '1')) return true;
  return false;
}

export function buildPlaceBidPlan({ caseRow, bid, person }) {
  return {
    page: '/pa/SubmitBid.aspx',
    button: 'ctl00$MainPlaceholder$PlaceBidButton',
    caseId: caseRow?.id || caseRow?.caseId || '',
    nycId: caseRow?.nycId || '',
    mandateId: caseRow?.mandateId || '',
    assignmentId: caseRow?.assignmentId || '',
    program: caseRow?.program || '',
    discipline: caseRow?.discipline || '',
    providerName: person?.name || '',
    providerId: bid?.personId || person?.id || '',
    note: 'Would post Place Bid for this confirmed portal bid. Does not change other SESIS data.',
  };
}

export async function placeBidForCase({ credentials, caseRow, bid, person, live, onStep }) {
  const plan = buildPlaceBidPlan({ caseRow, bid, person });
  if (!live) {
    onStep?.('dry-run', plan.caseId);
    return {
      ok: true,
      dryRun: true,
      status: 'pending-sesis',
      plan,
      message: 'Dry-run only. Set BIDS_SESIS_PLACE_BID=1 to place the bid in SESIS.',
    };
  }
  if (!credentials?.username || !credentials?.password) {
    return { ok: false, dryRun: false, error: 'SESIS credentials are missing.' };
  }
  const client = new SesisClient(credentials);
  onStep?.('login', 'sesis');
  const homeHtml = await client.login();
  const bidUrl = new URL('/pa/SubmitBid.aspx', client.origin).href;
  const homeUrl = new URL('/pa/Home.aspx', client.origin).href;
  const opened = await client.post(bidUrl, fillOpenBidsBodyExport(homeHtml), homeUrl);
  if (opened.kind !== 'html') {
    return { ok: false, dryRun: false, error: `Could not open SubmitBid.aspx (status=${opened.status})` };
  }
  onStep?.('place-bid', plan.caseId);
  const posted = await client.post(bidUrl, fillPlaceBidBodyExport(opened.html, plan), bidUrl);
  const ok = posted.status >= 200 && posted.status < 400;
  return {
    ok,
    dryRun: false,
    status: ok ? 'placed' : 'failed',
    plan,
    sesisStatus: posted.status,
    message: ok ? 'Place Bid was posted to SESIS.' : `SESIS Place Bid returned status ${posted.status}.`,
  };
}
