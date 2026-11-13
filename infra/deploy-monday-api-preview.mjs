/**
 * API Report nights, fixed at 03:00 UTC (11:00 PM EDT / 10:00 PM EST the evening before).
 * - WhiteGlove-MondayApiPreview: Monday night, dry-run, verified sessions + caregiver codes.
 * - TuesdaySessionsSchedule: retarget to Wednesday 03:00 UTC (Tuesday night Eastern) and enable.
 *
 * Does not change Lambda code and does not disable the nightly case rule.
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const region = 'us-east-1';
const mondayRule = 'WhiteGlove-MondayApiPreview';
const tuesdayRule = 'WhiteGloveStack-TuesdaySessionsScheduleC5134705-0uEUJoPO4wcQ';
const stateMachineArn = 'arn:aws:states:us-east-1:065194293782:stateMachine:PipelineStateMachine88B77A5B-eJgbrZEUeDAf';
const roleArn = 'arn:aws:iam::065194293782:role/WhiteGloveStack-PipelineStateMachineEventsRoleE4B26-O2vSdA8wMYO1';

function aws(args) {
  return execSync(`aws ${args}`, { encoding: 'utf8' });
}

const mondaySchedule = 'cron(0 3 ? * TUE *)';
const tuesdaySchedule = 'cron(0 3 ? * WED *)';

console.log(aws(
  `events put-rule --region ${region} --name ${mondayRule} --schedule-expression "${mondaySchedule}" --state ENABLED --description "Monday night API Report preview (dry-run). 03:00 UTC Tuesday = Monday 11:00 PM EDT / 10:00 PM EST."`,
));

const mondayTargets = path.join(__dirname, 'tmp-monday-api-preview-targets.json');
fs.writeFileSync(
  mondayTargets,
  JSON.stringify([
    {
      Id: 'Target0',
      Arn: stateMachineArn,
      RoleArn: roleArn,
      InputTransformer: {
        InputPathsMap: { id: '$.id' },
        InputTemplate:
          '{"sandbox":false,"sandboxEmailFixtures":false,"sandboxLiveFixtures":false,"runId":<id>,"dryRun":true,"reportKinds":["verified_sessions","caregiver_codes"]}',
      },
    },
  ]),
);
console.log(aws(`events put-targets --region ${region} --rule ${mondayRule} --targets file://${mondayTargets}`));

console.log(aws(
  `events put-rule --region ${region} --name ${tuesdayRule} --schedule-expression "${tuesdaySchedule}" --state ENABLED --description "Tuesday night live API Report. 03:00 UTC Wednesday = Tuesday 11:00 PM EDT / 10:00 PM EST."`,
));

const rules = aws(
  `events list-rules --region ${region} --query "Rules[?Name=='${mondayRule}' || Name=='${tuesdayRule}' || contains(Name, 'NightlyCase')].{Name:Name,State:State,ScheduleExpression:ScheduleExpression}" --output json`,
);
console.log(rules);

fs.writeFileSync(
  path.join(__dirname, 'cdk-monday-api-preview-deploy-out.txt'),
  [
    'Monday API preview + Tuesday live API',
    new Date().toISOString(),
    `Monday ${mondayRule} ${mondaySchedule} dryRun=true verified_sessions,caregiver_codes ENABLED`,
    `Tuesday ${tuesdayRule} ${tuesdaySchedule} dryRun=false (existing target) ENABLED`,
    rules.trim(),
    '',
  ].join('\n'),
);
try {
  fs.unlinkSync(mondayTargets);
} catch {
  /* ignore */
}
