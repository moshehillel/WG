import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
for (const line of readFileSync(path.join(repoRoot, ".env"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}
const NS = "https://www.hhaexchange.com/apis/hhaws.integration";
const URL = process.env.HHA_BASE_URL;
const APP = process.env.HHA_APP_NAME;
const SECRET = process.env.HHA_APP_SECRET;
const KEY = process.env.HHA_APP_KEY.replace(/\s+/g, "");
async function call(method, inner) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}">
      <Authentication>
        <AppName>${APP}</AppName>
        <AppSecret>${SECRET}</AppSecret>
        <AppKey>${KEY}</AppKey>
      </Authentication>
      ${inner}
    </${method}>
  </soap:Body>
</soap:Envelope>`;
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${NS}/${method}"` },
    body,
  });
  return res.text();
}
function summarize(xml) {
  return {
    status: xml.match(/Status="([^"]+)"/)?.[1],
    eid: xml.match(/<ErrorID>([^<]*)/)?.[1],
    msg: xml.match(/<ErrorMessage>([^<]*)/)?.[1],
    fault: xml.match(/<faultstring>([^<]*)/)?.[1],
  };
}

const visitId = 1282693446;
const info = await call("GetVisitInfoV2", `<VisitInfo><ID>${visitId}</ID></VisitInfo>`);
console.log("GetVisitInfoV2", summarize(info));
writeFileSync(path.join(repoRoot, "tmp", "visit-info-v2.xml"), info);
// print key fields
for (const tag of ["VisitID","PatientID","CaregiverID","VisitDate","VisitStartTime","VisitEndTime","EVVStartTime","EVVEndTime","ScheduleStartTime","ScheduleEndTime","TimesheetRequired","TimesheetApproved","ContractID","DisciplineID","OfficeID"]) {
  const m = info.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
  if (m) console.log(tag, m[1]);
}

const v3 = await call("GetVisitInfoV3", `<VisitInfo><ID>${visitId}</ID></VisitInfo>`);
console.log("GetVisitInfoV3", summarize(v3));

// Confirm with end time from visit if present
const end = info.match(/<VisitEndTime>([^<]+)/)?.[1] || info.match(/<ScheduleEndTime>([^<]+)/)?.[1] || "2026-07-10T11:00:00";
const start = info.match(/<VisitStartTime>([^<]+)/)?.[1] || info.match(/<ScheduleStartTime>([^<]+)/)?.[1] || "2026-07-10T09:00:00";
console.log("times", start, end);

const confirm = await call("ConfirmVisits", `<VisitInfo>
  <VisitID>${visitId}</VisitID>
  <VisitStartTime>${start}</VisitStartTime>
  <VisitEndTime>${end}</VisitEndTime>
  <TimesheetRequired>No</TimesheetRequired>
  <TimesheetApproved>Yes</TimesheetApproved>
</VisitInfo>`);
console.log("ConfirmVisits", summarize(confirm));
console.log(confirm.replace(/\s+/g, " ").slice(0, 500));

// Fetch CreateSchedule ASMX for ScheduleType allowed? try Master/Daily from visit
const vt = info.match(/<VisitType>([^<]+)/)?.[1];
const st = info.match(/<ScheduleType>([^<]+)/)?.[1];
console.log("from visit ScheduleType/VisitType", st, vt);
