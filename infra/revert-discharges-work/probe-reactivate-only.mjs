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
  return {status:xml.match(/Status="([^"]+)"/)?.[1], eid:xml.match(/<ErrorID>([^<]*)/)?.[1], msg:xml.match(/<ErrorMessage>([^<]*)/)?.[1], fault:xml.match(/<faultstring>([^<]*)/)?.[1], xml};
}
const reasons=await call('GetContractDischargeReason','<Status>Active</Status>');
const reasonRows=[...reasons.xml.matchAll(/<ReasonID>(\d+)<\/ReasonID>\s*<Reason>([^<]*)<\/Reason>\s*<ReasonDescription>([^<]*)<\/ReasonDescription>/gi)].map(m=>({id:m[1],reason:m[2],desc:m[3]}));
const tos=await call('GetPatientDischargeTo','');
const toRows=[...tos.xml.matchAll(/<PatientDischargeToID>(\d+)<\/PatientDischargeToID>\s*<PatientDischargeToName>([^<]*)<\/PatientDischargeToName>/g)].map(m=>({id:m[1],name:m[2]}));
const home=toRows.find(t=>/self|family|home/i.test(t.name))||toRows.find(t=>t.id==='198')||toRows[0];
const reason=reasonRows[0];
console.log({home, reasonSample: reasonRows.slice(0,3)});
// Solomon: ServiceCode ID was -1 — try UpdatePatientContract reactivate with full reason payload
const targets=[
  {name:'Arshad', pid:'22854608', place:'6812439'},
  {name:'Solomon', pid:'26367422', place:'8519959'},
];
const results=[];
for (const t of targets) {
  const variants=[
    `<PatientContractInfo><PatientID>${t.pid}</PatientID><PlacementID>${t.place}</PlacementID><UpdateDischargeDate>true</UpdateDischargeDate><DischargeDate xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/><DischargeToID>${home?.id||''}</DischargeToID><DischargeReasonID>${reason?.id||''}</DischargeReasonID><DischargeNote>Revert mistaken auto discharge</DischargeNote></PatientContractInfo>`,
    `<PatientContractInfo><PatientID>${t.pid}</PatientID><PlacementID>${t.place}</PlacementID><UpdateDischargeDate>false</UpdateDischargeDate><DischargeToID>${home?.id||''}</DischargeToID><DischargeReasonID>${reason?.id||''}</DischargeReasonID><DischargeNote>Revert mistaken auto discharge</DischargeNote></PatientContractInfo>`,
    `<PatientContractInfo><PatientID>${t.pid}</PatientID><PlacementID>${t.place}</PlacementID><UpdateDischargeDate>true</UpdateDischargeDate><DischargeReasonID>${reason?.id||''}</DischargeReasonID><DischargeNote>${reason?.desc||'revert'}</DischargeNote></PatientContractInfo>`,
  ];
  const tried=[];
  for (const [i,xml] of variants.entries()) {
    const r=await call('UpdatePatientContract', xml);
    tried.push({i, ok:r.status?.toLowerCase()==='success'||r.eid==='0', eid:r.eid, msg:r.msg, status:r.status, fault:r.fault});
    if (tried.at(-1).ok) break;
  }
  const after=await call('GetPatientContracts', `<PatientID>${t.pid}</PatientID><VisitDate>2026-09-20</VisitDate>`);
  const hist=await call('GetPatientContracts', `<PatientID>${t.pid}</PatientID><VisitDate>2026-09-14</VisitDate>`);
  const parse=(xml)=>[...xml.matchAll(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/g)].map(b=>({
    placementId:b[0].match(/<PlacementID>([^<]*)/)?.[1],
    disc:b[0].match(/<DischargeDate>([^<]*)/)?.[1]??'(empty)',
    start:b[0].match(/<ServiceStartDate>([^<]*)/)?.[1],
  }));
  results.push({name:t.name, place:t.place, tried, after:parse(after.xml), hist:parse(hist.xml)});
}
writeFileSync('infra/revert-discharges-work/reactivate-probe.json', JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
