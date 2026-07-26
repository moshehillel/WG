import type { Handler } from 'aws-lambda';
import type { DownloadResult, ParseResult } from '@white-glove/shared';
import {
  buildCaregiverCodeMap,
  DownloadResultSchema,
  errorMessage,
  getEnv,
  normalizedArtifactKey,
  normalizedReferenceKey,
  parseCaregiverCodesCsv,
} from '@white-glove/shared';
import {
  parseClosedCases,
  parseDischargeService,
  parseOpenedCases,
  parseVerifiedSessions,
} from '../parse-reports.js';
import { filterOpenedCases } from '../rules.js';
import { getObjectText, putJson } from '../s3.js';

export interface ParseEvent {
  download: DownloadResult;
  runId?: string;
}

async function loadReportCsv(
  bucket: string,
  runId: string,
  reportKind: string,
  key: string | undefined,
): Promise<string | null> {
  if (!key) return null;
  try {
    return await getObjectText(bucket, key);
  } catch (err) {
    throw new Error(
      `[ParseNormalize] runId=${runId} failed loading ${reportKind} CSV from s3://${bucket}/${key}: ${errorMessage(err)}`,
    );
  }
}

function parseReport<T>(
  runId: string,
  reportKind: string,
  raw: string,
  parser: (content: string) => T[],
): T[] {
  try {
    return parser(raw);
  } catch (err) {
    throw new Error(
      `[ParseNormalize] runId=${runId} failed parsing ${reportKind} CSV: ${errorMessage(err)}`,
    );
  }
}

export const handler: Handler<ParseEvent, ParseResult> = async (event) => {
  let runId = event.runId ?? event.download?.runId ?? 'unknown-run';
  try {
    const download = DownloadResultSchema.parse(event.download);
    runId = download.runId;
    const env = getEnv();
    const bucket = download.bucket || env.REPORTS_BUCKET;
    if (!bucket) {
      throw new Error(
        `[ParseNormalize] runId=${runId} missing REPORTS_BUCKET and download.bucket`,
      );
    }

    const [openedRaw, closedRaw, sessionsRaw, dischargeRaw, caregiverRaw] = await Promise.all([
      loadReportCsv(bucket, runId, 'opened_cases', download.keys.opened_cases),
      loadReportCsv(bucket, runId, 'closed_cases', download.keys.closed_cases),
      loadReportCsv(bucket, runId, 'verified_sessions', download.keys.verified_sessions),
      loadReportCsv(bucket, runId, 'discharge_service', download.keys.discharge_service),
      loadReportCsv(bucket, runId, 'caregiver_codes', download.keys.caregiver_codes),
    ]);

    const opened = openedRaw
      ? parseReport(runId, 'opened_cases', openedRaw, parseOpenedCases)
      : [];
    const closed = closedRaw
      ? parseReport(runId, 'closed_cases', closedRaw, parseClosedCases)
      : [];
    const sessions = sessionsRaw
      ? parseReport(runId, 'verified_sessions', sessionsRaw, parseVerifiedSessions)
      : [];
    const discharge = dischargeRaw
      ? parseReport(runId, 'discharge_service', dischargeRaw, parseDischargeService)
      : [];
    const caregiverEntries = caregiverRaw
      ? parseCaregiverCodesCsv(caregiverRaw)
      : [];

    const { kept } = filterOpenedCases(opened);

    const artifactKeys = {
      opened_cases: normalizedArtifactKey(download.runId, 'opened_cases'),
      closed_cases: normalizedArtifactKey(download.runId, 'closed_cases'),
      verified_sessions: normalizedArtifactKey(download.runId, 'verified_sessions'),
      ...(caregiverEntries.length
        ? { caregiver_codes: normalizedReferenceKey(download.runId, 'caregiver_codes') }
        : {}),
      ...(discharge.length
        ? { discharge_service: normalizedReferenceKey(download.runId, 'discharge_service') }
        : {}),
    };

    try {
      const uploads: Promise<void>[] = [
        putJson(bucket, artifactKeys.opened_cases, kept),
        putJson(bucket, artifactKeys.closed_cases, closed),
        putJson(bucket, artifactKeys.verified_sessions, sessions),
      ];
      if (artifactKeys.caregiver_codes) {
        uploads.push(
          putJson(bucket, artifactKeys.caregiver_codes, {
            entries: caregiverEntries,
            map: Object.fromEntries(buildCaregiverCodeMap(caregiverEntries)),
          }),
        );
      }
      if (artifactKeys.discharge_service) {
        uploads.push(putJson(bucket, artifactKeys.discharge_service, discharge));
      }
      await Promise.all(uploads);
    } catch (err) {
      throw new Error(
        `[ParseNormalize] runId=${runId} failed writing normalized artifacts to s3://${bucket}: ${errorMessage(err)}`,
      );
    }

    return {
      runId: download.runId,
      counts: {
        opened_cases: opened.length,
        closed_cases: closed.length,
        verified_sessions: sessions.length,
        opened_cases_after_ei_filter: kept.length,
        discharge_service: discharge.length || undefined,
        caregiver_codes: caregiverEntries.length || undefined,
      },
      artifactKeys,
    };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[ParseNormalize]')) throw err;
    throw new Error(`[ParseNormalize] runId=${runId} unexpected failure: ${errorMessage(err)}`);
  }
};
