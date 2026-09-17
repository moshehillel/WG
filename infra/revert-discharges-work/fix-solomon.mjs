import { readFileSync, writeFileSync } from 'node:fs';
for (const line of readFileSync('.env','utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('=')) continue;
  const i=t.indexOf('='); const k=t.slice(0,i).trim(); if(!(k in process.env)) process.env[k]=t.slice(i+1).trim();
}
const NS='https://www.hhaexchange.com/apis/hhaws.integration';
const URL='https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';
const APP=process.env.HHA_APP_NAME, SECRET=process.env.HHA_APP_SECRET, KEY=(process.env.HHA_APP_KEY||'').replace(/\s+/g,'');
async function call(method, inner='') {
  const body=`<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${method} xmlns="${NS}"><Authentication><AppName>${APP}</AppName><AppSecret>${SECRET}</AppSecret><AppKey>${KEY}</AppKey></Authentication>${inner}</${method}></soap:Body></soap:Envelope>`;
  const res=await fetch(URL,{method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:`"${NS}/${method}"`},body});
  const xml=await res.text();
  return {xml, status:xml.match(/Status="([^"]+)"/)?.[1], eid:xml.match(/<ErrorID>([^<]*)/)?.[1], msg:xml.match(/<ErrorMessage>([^<]*)/)?.[1]};
}
const pid='26367422';
const r=await call('GetPatientContracts', `<PatientID>${pid}</PatientID><VisitDate>2026-09-14</VisitDate>`);
writeFileSync('infra/revert-discharges-work/solomon-contracts.xml', r.xml);
const block=(r.xml.match(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/)||[])[0]||'';
console.log(block);
const contract=block.match(/<Contract>\s*<ID>(\d+)/)?.[1];
const svc=block.match(/<ServiceCode>\s*<ID>(\d+)/)?.[1] || block.match(/<ServiceCodeID>(\d+)/)?.[1];
console.log({contract, svc, status:r.status});
if (contract && svc) {
  const add=await call('AddPatientContract', `<PatientContractInfo><PatientID>${pid}</PatientID><ContractID>${contract}</ContractID><ServiceCodeID>${svc}</ServiceCodeID><StartDate>2026-09-16</StartDate></PatientContractInfo>`);
  console.log({addOk: add.status, eid:add.eid, msg:add.msg, preview:add.xml.replace(/\s+/g,' ').slice(0,400)});
  const after=await call('GetPatientContracts', `<PatientID>${pid}</PatientID><VisitDate>2026-09-20</VisitDate>`);
  console.log('after', [...after.xml.matchAll(/<PlacementID>(\d+)[\s\S]*?<DischargeDate>([^<]*)/g)].map(m=>({p:m[1],d:m[2]||'active'})));
  console.log('after placements raw ids', [...after.xml.matchAll(/<PlacementID>(\d+)/g)].map(m=>m[1]));
}
