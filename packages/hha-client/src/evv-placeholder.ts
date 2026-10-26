import type { HhaSoapClient } from './soap-client.js';
import { isEvvPlaceholderSchedule, psDateToIso } from './hha-time.js';
import { xmlFirstTag, xmlIds } from './hha-xml-parse.js';

/** How far back from the real visit to look for the 1:00 AM scaffolding visit. */
const LOOKBACK_DAYS = 120;
const INFO_CAP = 80;
const INFO_CONCURRENCY = 8;

export type PlaceholderRemovalCache = {
  reasonId?: string;
  cleared: Set<string>;
};

function addIsoDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function nestedTag(xml: string, parent: string, child: string): string | undefined {
  const block = xml.match(new RegExp(`<${parent}>([\\s\\S]*?)</${parent}>`, 'i'))?.[1];
  if (!block) return undefined;
  return xmlFirstTag(block, child);
}

function parseDeleteReasonId(xml: string): string | undefined {
  const reasons = [...xml.matchAll(/<ReasonID>(\d+)<\/ReasonID>[\s\S]{0,160}?<(?:Reason|ReasonDescription|Description)>([^<]*)</gi)];
  const wanted = reasons.find((m) => m[2]?.trim().toLowerCase() === 'delete')
    ?? reasons.find((m) => m[2]?.trim().toLowerCase() === 'data entry error');
  return wanted?.[1];
}

async function searchIds(
  soap: HhaSoapClient,
  patientId: string,
  caregiverId: string | undefined,
  startDate: string,
  endDate: string,
): Promise<string[]> {
  const found = await soap.searchVisits({
    patientId: Number(patientId),
    caregiverId: caregiverId ? Number(caregiverId) : undefined,
    startDate,
    endDate,
  });
  if (!found.ok) {
    throw new Error(
      `SearchVisits failed while looking for the 1:00 AM placeholder: ${found.errorMessage ?? found.status} (ErrorID=${found.errorId ?? '?'})`,
    );
  }
  return [...new Set(xmlIds(found.bodyXml, 'VisitID').map(String))];
}

async function visitIdsForPlaceholderScan(
  soap: HhaSoapClient,
  patientId: string,
  caregiverId: string | undefined,
  visitDate: string,
): Promise<string[]> {
  const end = psDateToIso(visitDate) ?? visitDate;
  const start = addIsoDays(end, -LOOKBACK_DAYS);
  try {
    return await searchIds(soap, patientId, caregiverId, start, end);
  } catch {
    const ids: string[] = [];
    let cursor = start;
    while (cursor <= end) {
      const chunkEnd = addIsoDays(cursor, 13);
      const to = chunkEnd < end ? chunkEnd : end;
      ids.push(...(await searchIds(soap, patientId, caregiverId, cursor, to)));
      cursor = addIsoDays(to, 1);
    }
    return [...new Set(ids)];
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]!);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

async function deleteReasonId(
  soap: HhaSoapClient,
  visitId: string,
  cache: PlaceholderRemovalCache,
): Promise<string> {
  if (cache.reasonId) return cache.reasonId;
  const reasons = await soap.call('GetVisitDeleteReasons', `<VisitID>${visitId}</VisitID>`);
  if (!reasons.ok) {
    throw new Error(
      `GetVisitDeleteReasons failed: ${reasons.errorMessage ?? reasons.status} (ErrorID=${reasons.errorId ?? '?'})`,
    );
  }
  const reasonId = parseDeleteReasonId(reasons.bodyXml);
  if (!reasonId) {
    throw new Error('HHA visit-delete reasons have no "Delete" or "Data Entry Error" entry');
  }
  cache.reasonId = reasonId;
  return reasonId;
}

/**
 * Delete 1:00–1:30 AM scaffolding visits for this patient and caregiver.
 * Skips the real visit, clocked visits, and missed visits.
 */
export async function removeEvvPlaceholderVisits(
  soap: HhaSoapClient,
  options: {
    patientId: string;
    caregiverId?: string;
    visitDate?: string;
    keepVisitId?: string;
  },
  cache: PlaceholderRemovalCache,
): Promise<{ deletedVisitIds: string[] }> {
  const patientId = options.patientId.trim();
  if (!patientId || !options.visitDate?.trim()) return { deletedVisitIds: [] };

  const key = `${patientId}|${options.caregiverId ?? ''}`;
  if (cache.cleared.has(key)) return { deletedVisitIds: [] };

  const ids = await visitIdsForPlaceholderScan(
    soap,
    patientId,
    options.caregiverId,
    options.visitDate,
  );
  const candidates = ids
    .filter((id) => id !== options.keepVisitId)
    .slice(0, INFO_CAP);

  const matches = await mapPool(candidates, INFO_CONCURRENCY, async (id) => {
    const info = await soap.getVisitInfoV2(Number(id));
    if (!info.ok) return undefined;
    const caregiverId = nestedTag(info.bodyXml, 'Caregiver', 'ID');
    if (
      options.caregiverId &&
      caregiverId &&
      caregiverId !== options.caregiverId
    ) {
      return undefined;
    }
    const missed = xmlFirstTag(info.bodyXml, 'IsMissedVisit');
    if (/^y/i.test(missed ?? '')) return undefined;
    const evvStart = xmlFirstTag(info.bodyXml, 'EVVStartTime');
    if (evvStart?.trim()) return undefined;
    if (
      !isEvvPlaceholderSchedule(
        xmlFirstTag(info.bodyXml, 'ScheduleStartTime'),
        xmlFirstTag(info.bodyXml, 'ScheduleEndTime'),
      )
    ) {
      return undefined;
    }
    return id;
  });

  const deletedVisitIds: string[] = [];
  for (const id of matches) {
    if (!id) continue;
    const reasonId = await deleteReasonId(soap, id, cache);
    const deleted = await soap.call(
      'DeleteVisit',
      `<DeleteVisitInfo><VisitID>${id}</VisitID><ReasonID>${reasonId}</ReasonID></DeleteVisitInfo>`,
    );
    if (!deleted.ok) {
      throw new Error(
        `DeleteVisit ${id} failed: ${deleted.errorMessage ?? deleted.status} (ErrorID=${deleted.errorId ?? '?'})`,
      );
    }
    deletedVisitIds.push(id);
    console.info(
      `[verified_sessions] removed 1:00 AM placeholder visit ${id} patient=${patientId} caregiver=${options.caregiverId ?? '?'}`,
    );
  }

  if (ids.length <= INFO_CAP) cache.cleared.add(key);
  return { deletedVisitIds };
}
