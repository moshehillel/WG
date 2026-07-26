export function xmlIds(xml: string, tag: string): number[] {
  const re = new RegExp(`<${tag}>(\\d+)</${tag}>`, 'gi');
  return [...xml.matchAll(re)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
}

export function xmlFirstTag(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))?.[1]?.trim();
}

export interface CallDashboardEntry {
  callDashboardId: string;
  callTime?: string;
  patientId?: string;
  caregiverId?: string;
}

export function parseCallDashboardEntries(xml: string): CallDashboardEntry[] {
  const list: CallDashboardEntry[] = [];
  for (const block of xml.match(/<CallDashboardInfo>[\s\S]*?<\/CallDashboardInfo>/gi) ?? []) {
    list.push({
      callDashboardId:
        xmlFirstTag(block, 'CallDashboardID') ??
        xmlFirstTag(block, 'CallDashBoardID') ??
        '',
      callTime: xmlFirstTag(block, 'CallTime'),
      patientId: xmlFirstTag(block, 'PatientID'),
      caregiverId: xmlFirstTag(block, 'CaregiverID'),
    });
  }
  if (list.length) return list.filter((e) => e.callDashboardId);

  for (const m of xml.matchAll(
    /<CallDashboardID>(\d+)<\/CallDashboardID>[\s\S]*?<CallTime>([^<]*)/gi,
  )) {
    list.push({ callDashboardId: m[1]!, callTime: m[2]?.trim() });
  }
  return list;
}

export function parsePayCodesFromXml(xml: string): Array<{ id: string; name: string }> {
  const list: Array<{ id: string; name: string }> = [];
  for (const m of xml.matchAll(
    /<PayCodeID>(\d+)<\/PayCodeID>\s*<PayCodeName>([^<]*)<\/PayCodeName>/gi,
  )) {
    list.push({ id: m[1]!, name: m[2]!.trim() });
  }
  for (const m of xml.matchAll(/<PayCode>\s*<ID>(\d+)<\/ID>\s*<Name>([^<]*)<\/Name>/gi)) {
    list.push({ id: m[1]!, name: m[2]!.trim() });
  }
  return [...new Map(list.map((p) => [p.id, p])).values()];
}
