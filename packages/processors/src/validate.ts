import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type {
  PipelineException,
  ProcessorResult,
  ValidateResult,
} from '@white-glove/shared';
import { exceptionsKey, getEnv, validateSummaryKey } from '@white-glove/shared';
import { putJson } from './s3.js';

const sns = new SNSClient({});

export async function validateAndNotify(options: {
  runId: string;
  bucket: string;
  opened?: ProcessorResult;
  closed?: ProcessorResult;
  sessions?: ProcessorResult;
  topicArn?: string;
}): Promise<ValidateResult> {
  const exceptions: PipelineException[] = [
    ...(options.opened?.exceptions ?? []),
    ...(options.closed?.exceptions ?? []),
    ...(options.sessions?.exceptions ?? []),
  ];

  const hardFailures =
    (options.opened?.failed ?? 0) +
    (options.closed?.failed ?? 0) +
    (options.sessions?.failed ?? 0);

  const result: ValidateResult = {
    runId: options.runId,
    ok: hardFailures === 0,
    summary: {
      opened: options.opened,
      closed: options.closed,
      sessions: options.sessions,
    },
    exceptions,
    exceptionCount: exceptions.length,
  };

  await putJson(options.bucket, validateSummaryKey(options.runId), result);
  await putJson(options.bucket, exceptionsKey(options.runId), exceptions);

  const topicArn = options.topicArn ?? getEnv().EXCEPTION_TOPIC_ARN;
  if (topicArn && (!result.ok || exceptions.length > 0)) {
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: `White-glove run ${options.runId}: ${result.ok ? 'exceptions' : 'FAILED'}`,
        Message: JSON.stringify(
          {
            runId: options.runId,
            ok: result.ok,
            exceptionCount: exceptions.length,
            hardFailures,
            sample: exceptions.slice(0, 20),
          },
          null,
          2,
        ),
      }),
    );
  }

  return result;
}
