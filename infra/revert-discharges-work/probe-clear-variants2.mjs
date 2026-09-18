import { readFileSync, writeFileSync } from 'node:fs';
for (const line of readFileSync('.env','utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('=')) continue;
  const i=t.indexOf('='); const k=t.slice(0,i).trim(); if(!(k in process.env)) process.env[k]=t.slice(i+1).trim();
}
const NS='https://www.hhaexchange.com/apis/hhaws.integration';
const URL='https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP=process.env.HHA_APP_NAME, SECRET=process.env.HHA_APP_SECRET, KEY=(process.env.HHA_APP_KEY||'').replace(/\s+/g,'');
async function call(method, inner) {
  const body=`<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soap:Body><${method} xmlns="${NS}"><Authentication><AppName>${APP}</AppName><AppSecret>${SECRET}</AppSecret><AppKey>${KEY}</AppKey></Authentication>${inner}</${method}></soap:Body></soap:Envelope>`;
  const res=await fetch(URL,{method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:`"${NS}/${method}"`},body});
  const xml=await res.text();
  return {http:res.status,status:xml.match(/Status="([^"]+)"/)?.[1],eid:xml.match(/<ErrorID>([^<]*)/)?.[1],msg:xml.match(/<ErrorMessage>([^<]*)/)?.[1],fault:xml.match(/<faultstring>([^<]*)/)?.[1],xml};
}
function placements(xml){
  return [...xml.matchAll(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/g)].map(b=>{
    const block=b[0];
    return {
      placementId: block.match(/<PlacementID>([^<]*)/)?.[1],
      start: block.match(/<ServiceStartDate>([^<]*)/)?.[1],
      disc: block.match(/<DischargeDate>([^<]*)/)?.[1] ?? '(nil/empty)',
      svc: block.match(/<ServiceCode>\s*<ID>(\d+)/)?.[1],
      contract: block.match(/<Contract>\s*<ID>(\d+)/)?.[1],
    };
  });
}
const pid='22854608', place='6812439';
// reasons
const reasons=await call('GetDischargeReasons','');
const reasonPreview=[...reasons.xml.matchAll(/<DischargeReasonInfo>[\s\S]*?<\/DischargeReasonInfo>/g)].slice(0,8).map(b=>({
  id:b[0].match(/<ID>([^<]*)/)?.[1]||b[0].match(/<DischargeReasonID>([^<]*)/)?.[1],
  name:b[0].match(/<Name>([^<]*)/)?.[1]||b[0].match(/<Description>([^<]*)/)?.[1]
}));
const toList=await call('GetDischargeTo','');
const toPreview=[...toList.xml.matchAll(/<(?:DischargeToInfo|DischargeTo)>[\s\S]*?<\/(?:DischargeToInfo|DischargeTo)>/g)].slice(0,8).map(b=>({
  id:b[0].match(/<ID>([^<]*)/)?.[1],
  name:b[0].match(/<Name>([^<]*)/)?.[1]
}));
const variants=[
  ['xsi:nil DischargeDate', `<PatientContractInfo><PatientID>${pid}</PatientID><PlacementID>${place}</PlacementID><UpdateDischargeDate>true</UpdateDischargeDate><DischargeDate xsi:nil="true" /></PatientContractInfo>`],
  ['1900-01-01', `<PatientContractInfo><PatientID>${pid}</PatientID><PlacementID>${place}</PlacementID><UpdateDischargeDate>true</UpdateDischargeDate><DischargeDate>1900-01-01</DischargeDate><DischargeToID>1</DischargeToID><DischargeReasonID>1</DischargeReasonID><DischargeNote>revert mistaken auto discharge</DischargeNote></PatientContractInfo>`],
  ['with reason+to empty date via min date 0001', `<PatientContractInfo><PatientID>${pid}</PatientID><PlacementID>${place}</PlacementID><UpdateDischargeDate>true</UpdateDischargeDate><DischargeDate>0001-01-01</DischargeDate><DischargeToID>1</DischargeToID><DischargeReasonID>1</DischargeReasonID></PatientContractInfo>`],
];
const results=[];
for (const [label,xml] of variants) {
  const r=await call('UpdatePatientContract', xml);
  results.push({label,ok:r.status?.toLowerCase()==='success'||r.eid==='0',eid:r.eid,msg:r.msg,status:r.status,fault:r.fault});
}
const dates=['2026-09-14','2026-09-15','2026-09-16','2026-09-20','2024-12-07'];
const snaps={};
for (const d of dates) {
  const r=await call('GetPatientContracts', `<PatientID>${pid}</PatientID><VisitDate>${d}</VisitDate>`);
  snaps[d]={ok:r.status, eid:r.eid, placements:placements(r.xml)};
}
writeFileSync('infra/revert-discharges-work/clear-variants-probe2.json', JSON.stringify({reasonPreview,toPreview,results,snaps},null,2));
console.log(JSON.stringify({reasonPreview,toPreview,results,snaps},null,2));
