import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

const files = [
  path.join(process.env.USERPROFILE, 'Downloads', 'app.hhaexchange.com.har'),
  path.join(process.env.USERPROFILE, 'Downloads', 'ent.app.hhaexchange.com.har'),
];

const patterns = [
  /AcceptedServices/i,
  /acceptedServices/i,
  /Accepted Service/i,
  /patientDisciplines/i,
  /PatientDiscipline/i,
  /savePatient/i,
  /updatePatientProfile/i,
  /updateDemographics/i,
  /disciplines.*patient/i,
];

for (const file of files) {
  console.log('\n====', file);
  let lineNo = 0;
  let hits = 0;
  try {
    const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      lineNo++;
      for (const p of patterns) {
        if (p.test(line)) {
          hits++;
          const idx = line.search(p);
          const start = Math.max(0, idx - 100);
          console.log(`L${lineNo}: ...${line.slice(start, start + 280).replace(/\s+/g, ' ')}...`);
          if (hits >= 40) break;
        }
      }
      if (hits >= 40) break;
    }
    console.log(`hits=${hits} linesScanned=${lineNo}`);
  } catch (e) {
    console.log('skip', e.message);
  }
}
