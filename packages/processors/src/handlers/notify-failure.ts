import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { Handler } from 'aws-lambda';
import {
  errorMessage,
  formatPipelineAlertBody,
  getEnv,
  parseStepFunctionsCause,
} from '@white-glove/shared';

const sns = new SNSClient({});

export interface NotifyFailureEvent {
  runId?: string;
  /** Set by Step Functions Catch resultPath (States error object). */
  error?: {
    Error?: string;
    Cause?: string;
  };
  /** Optional explicit step name when not available from SFN. */
  step?: string;
}

export const handler: Handler<NotifyFailureEvent, { notified: boolean }> = async (event) => {
  const env = getEnv();
  const topicArn = env.EXCEPTION_TOPIC_ARN;
  if (!topicArn) {
    console.warn('EXCEPTION_TOPIC_ARN not set; skipping pipeline failure notification');
    return { notified: false };
  }

  const runId = event.runId ?? 'unknown-run';
  const step = event.step ?? event.error?.Error ?? 'unknown-step';
  const parsed = parseStepFunctionsCause(event.error?.Cause);
  const pipelineError =
    parsed.errorMessage ??
    (event.error?.Cause ? errorMessage(event.error.Cause) : 'Pipeline step failed with no cause');

  const body = formatPipelineAlertBody({
    runId,
    ok: false,
    hardFailures: 0,
    exceptions: [],
    pipelineStep: step,
    pipelineError,
  });

  await sns.send(
    new PublishCommand({
      TopicArn: topicArn,
      Subject: `White-glove run ${runId}: pipeline step FAILED (${step})`,
      Message: body,
    }),
  );

  return { notified: true };
};
