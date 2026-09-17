import { readFileSync, writeFileSync } from 'node:fs';

const p =
  'C:/Users/Moshe/.cursor/projects/c-Users-Moshe-Desktop-custom-projects-White-glove/agent-transcripts/ea3e8c68-60b3-479a-91c6-0d7accb9e8d7/ea3e8c68-60b3-479a-91c6-0d7accb9e8d7.jsonl';
const lines = readFileSync(p, 'utf8').split(/\n/);
const hits = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!/Picciuto|Solomon|8522217|8519959|PatientID/i.test(line)) continue;
  // Extract useful snippets
  const snippets = [];
  for (const re of [
    /.{0,40}Picciuto.{0,200}/gi,
    /.{0,40}Solomon.{0,200}/gi,
    /.{0,30}8522217.{0,80}/gi,
    /.{0,30}8519959.{0,80}/gi,
    /PatientID[=\":\s]+(\d{6,})/gi,
  ]) {
    const m = line.match(re);
    if (m) snippets.push(...m.slice(0, 10));
  }
  if (snippets.length) hits.push({ line: i, snippets: snippets.slice(0, 20) });
}
writeFileSync(
  'infra/revert-discharges-work/transcript-picciuto-solomon.json',
  JSON.stringify(hits, null, 2),
);
console.log('hit lines', hits.length);
for (const h of hits.slice(0, 15)) {
  console.log('LINE', h.line);
  for (const s of h.snippets.slice(0, 8)) console.log(' ', s.replace(/\s+/g, ' ').slice(0, 220));
}
