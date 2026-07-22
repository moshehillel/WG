/** Reason + action pair for ConfirmVisits. */
export interface VisitConfirmReasonPair {
  reasonCode: string;
  actionCode: string;
}

export interface VisitConfirmTimes {
  startIso: string;
  endIso: string;
}

/** Parse VisitEditReasonID / VisitEditActionTakenReasonID pairs from GetVisitEditReasonActionTaken XML. */
export function parseVisitEditReasonPairs(xml: string): VisitConfirmReasonPair[] {
  const pairs: VisitConfirmReasonPair[] = [];
  for (const m of xml.matchAll(
    /<VisitEditReasonID>(\d+)<\/VisitEditReasonID>[\s\S]*?<VisitEditActionTakenReasonID>(\d+)<\/VisitEditActionTakenReasonID>/gi,
  )) {
    pairs.push({ reasonCode: m[1]!, actionCode: m[2]! });
  }
  const seen = new Set<string>();
  return pairs.filter((p) => {
    const k = `${p.reasonCode}:${p.actionCode}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Convert HHA date + time ("2026-07-10", "09:00" or "2026-07-10 09:00") to ISO for ConfirmVisits. */
export function toConfirmIso(dateStr: string, timeStr: string): string {
  const date = dateStr.trim().slice(0, 10);
  let time = timeStr.trim();
  const spaceParts = time.split(' ');
  if (spaceParts.length > 1) time = spaceParts[spaceParts.length - 1]!;
  const [h, m = '00'] = time.split(':');
  return `${date}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00`;
}

/**
 * Extract confirm window from GetVisitInfoV2 XML.
 * Prefers actual visit times, then schedule times.
 */
export function parseVisitConfirmTimes(xml: string): VisitConfirmTimes | undefined {
  const date =
    xml.match(/<VisitDate>([^<]+)/i)?.[1]?.trim() ??
    xml.match(/<ScheduleDate>([^<]+)/i)?.[1]?.trim();
  if (!date) return undefined;

  const startRaw =
    xml.match(/<VisitStartTime>([^<]+)/i)?.[1] ??
    xml.match(/<EVVStartTime>([^<]+)/i)?.[1] ??
    xml.match(/<ScheduleStartTime>([^<]+)/i)?.[1];
  const endRaw =
    xml.match(/<VisitEndTime>([^<]+)/i)?.[1] ??
    xml.match(/<EVVEndTime>([^<]+)/i)?.[1] ??
    xml.match(/<ScheduleEndTime>([^<]+)/i)?.[1];

  if (!startRaw || !endRaw) return undefined;
  return {
    startIso: toConfirmIso(date, startRaw),
    endIso: toConfirmIso(date, endRaw),
  };
}

export function parseTimesheetFlags(xml: string): {
  timesheetRequired: 'Yes' | 'No';
  timesheetApproved: 'Yes' | 'No';
} {
  const req = xml.match(/<TimesheetRequired>([^<]+)/i)?.[1]?.trim().toLowerCase();
  const appr = xml.match(/<TimesheetApproved>([^<]+)/i)?.[1]?.trim().toLowerCase();
  const yes = (v: string | undefined) => v === 'yes' || v === 'y' || v === 'true' || v === '1';
  return {
    timesheetRequired: yes(req) ? 'Yes' : 'No',
    timesheetApproved: yes(appr) ? 'Yes' : 'No',
  };
}

export function buildConfirmVisitsBody(options: {
  visitId: string;
  times: VisitConfirmTimes;
  reasonCode: string;
  actionCode: string;
  timesheetRequired: 'Yes' | 'No';
  timesheetApproved: 'Yes' | 'No';
}): string {
  return `<VisitInfo>
  <VisitID>${escapeXml(options.visitId)}</VisitID>
  <VisitStartTime>${escapeXml(options.times.startIso)}</VisitStartTime>
  <VisitEndTime>${escapeXml(options.times.endIso)}</VisitEndTime>
  <ReasonCode>${escapeXml(options.reasonCode)}</ReasonCode>
  <ActionCode>${escapeXml(options.actionCode)}</ActionCode>
  <TimesheetRequired>${options.timesheetRequired}</TimesheetRequired>
  <TimesheetApproved>${options.timesheetApproved}</TimesheetApproved>
</VisitInfo>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Timesheet flag combos to try (sandbox-proven order). */
export function timesheetConfirmAttempts(
  visitFlags: { timesheetRequired: 'Yes' | 'No'; timesheetApproved: 'Yes' | 'No' },
): Array<{ timesheetRequired: 'Yes' | 'No'; timesheetApproved: 'Yes' | 'No' }> {
  const attempts: Array<{ timesheetRequired: 'Yes' | 'No'; timesheetApproved: 'Yes' | 'No' }> = [
    { timesheetRequired: 'No', timesheetApproved: 'No' },
    { timesheetRequired: visitFlags.timesheetRequired, timesheetApproved: 'Yes' },
    { timesheetRequired: 'Yes', timesheetApproved: 'Yes' },
  ];
  const seen = new Set<string>();
  return attempts.filter((a) => {
    const k = `${a.timesheetRequired}:${a.timesheetApproved}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
