import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../..');

export class WhiteGloveStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const alertEmailRaw =
      (this.node.tryGetContext('alertEmails') as string | undefined) ??
      (this.node.tryGetContext('alertEmail') as string | undefined);
    const alertEmails = alertEmailRaw
      ? alertEmailRaw.split(',').map((e) => e.trim()).filter(Boolean)
      : [];

    const reportsBucket = new s3.Bucket(this, 'ReportsBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          id: 'expire-old-runs',
          expiration: cdk.Duration.days(90),
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    const providerSoftSecret = new secretsmanager.Secret(this, 'ProviderSoftSecret', {
      description: 'ProviderSoft login credentials (baseUrl, username, password)',
      secretObjectValue: {
        baseUrl: cdk.SecretValue.unsafePlainText('https://CHANGE_ME.providersoft.com'),
        username: cdk.SecretValue.unsafePlainText('CHANGE_ME'),
        password: cdk.SecretValue.unsafePlainText('CHANGE_ME'),
      },
    });

    const hhaSecret = new secretsmanager.Secret(this, 'HhaSecret', {
      description: 'HHA API credentials (baseUrl, apiKey)',
      secretObjectValue: {
        baseUrl: cdk.SecretValue.unsafePlainText('https://CHANGE_ME'),
        apiKey: cdk.SecretValue.unsafePlainText('CHANGE_ME'),
      },
    });

    const exceptionTopic = new sns.Topic(this, 'ExceptionTopic', {
      displayName: 'White-glove pipeline exceptions',
    });
    for (const email of alertEmails) {
      exceptionTopic.addSubscription(new subscriptions.EmailSubscription(email));
    }

    const hhaUseMock = String(this.node.tryGetContext('hhaUseMock') ?? 'false') === 'true';

    const sharedEnv: Record<string, string> = {
      REPORTS_BUCKET: reportsBucket.bucketName,
      IDEMPOTENCY_TABLE: idempotencyTable.tableName,
      EXCEPTION_TOPIC_ARN: exceptionTopic.topicArn,
      HHA_USE_MOCK: hhaUseMock ? 'true' : 'false',
      NODE_OPTIONS: '--enable-source-maps',
    };

    // Download Lambda:
    // - Default: zip stub (no Docker) — safe until PS secrets + reports are ready
    // - Production bot: cdk deploy -c providerSoftLiveBot=true  (Playwright Chromium image)
    // - Keep stubs inside the image until ready: -c providerSoftUseStubs=true (default true)
    const providerSoftLiveBot =
      String(this.node.tryGetContext('providerSoftLiveBot') ?? 'false') === 'true';
    const providerSoftUseStubs =
      String(this.node.tryGetContext('providerSoftUseStubs') ?? 'true') === 'true';
    const enableDailySchedule =
      String(this.node.tryGetContext('enableDailySchedule') ?? 'false') === 'true';

    const bundling = {
      minify: true,
      sourceMap: true,
      target: 'node22',
      format: OutputFormat.ESM,
      banner:
        "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      mainFields: ['module', 'main'] as string[],
      externalModules: ['playwright', 'playwright-core', '@playwright/test'],
    };

    const downloadEnv = {
      ...sharedEnv,
      PROVIDERSOFT_SECRET_ARN: providerSoftSecret.secretArn,
      PROVIDERSOFT_USE_STUBS: providerSoftUseStubs ? 'true' : 'false',
      HEADLESS: 'true',
      PROVIDERSOFT_REPORT_OPENED_ID: '4526',
      PROVIDERSOFT_REPORT_CLOSED_ID: '4527',
      PROVIDERSOFT_REPORT_DISCHARGE_ID: '4528',
      PROVIDERSOFT_REPORT_SESSIONS_ID: '4026',
      PROVIDERSOFT_REPORT_KINDS: 'opened_cases,closed_cases,verified_sessions',
    };

    const downloadFn: lambda.IFunction = providerSoftLiveBot
      ? new lambda.DockerImageFunction(this, 'ProviderSoftDownloadFn', {
          code: lambda.DockerImageCode.fromImageAsset(repoRoot, {
            file: 'packages/providersoft-bot/Dockerfile',
          }),
          timeout: cdk.Duration.minutes(15),
          memorySize: 3008,
          ephemeralStorageSize: cdk.Size.mebibytes(2048),
          environment: downloadEnv,
          architecture: lambda.Architecture.X86_64,
        })
      : new NodejsFunction(this, 'ProviderSoftDownloadFn', {
          entry: path.join(repoRoot, 'packages/providersoft-bot/src/stub-handler.ts'),
          handler: 'handler',
          runtime: lambda.Runtime.NODEJS_22_X,
          timeout: cdk.Duration.minutes(5),
          memorySize: 512,
          environment: downloadEnv,
          bundling,
          depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
          projectRoot: repoRoot,
        });
    reportsBucket.grantReadWrite(downloadFn);
    providerSoftSecret.grantRead(downloadFn);

    const makeProcessor = (functionId: string, entry: string) => {
      const fn = new NodejsFunction(this, functionId, {
        entry: path.join(repoRoot, entry),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        timeout: cdk.Duration.minutes(5),
        memorySize: 1024,
        environment: {
          ...sharedEnv,
          HHA_SECRET_ARN: hhaSecret.secretArn,
        },
        bundling,
        depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
        projectRoot: repoRoot,
      });
      reportsBucket.grantReadWrite(fn);
      idempotencyTable.grantReadWriteData(fn);
      hhaSecret.grantRead(fn);
      exceptionTopic.grantPublish(fn);
      return fn;
    };

    const parseFn = makeProcessor('ParseFn', 'packages/processors/src/handlers/parse.ts');
    const openedFn = makeProcessor('OpenedFn', 'packages/processors/src/handlers/opened.ts');
    const closedFn = makeProcessor('ClosedFn', 'packages/processors/src/handlers/closed.ts');
    const sessionsFn = makeProcessor('SessionsFn', 'packages/processors/src/handlers/sessions.ts');
    const validateFn = makeProcessor('ValidateFn', 'packages/processors/src/handlers/validate.ts');

    const notifyFailureFn = new NodejsFunction(this, 'NotifyFailureFn', {
      entry: path.join(repoRoot, 'packages/processors/src/handlers/notify-failure.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: sharedEnv,
      bundling,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      projectRoot: repoRoot,
    });
    exceptionTopic.grantPublish(notifyFailureFn);

    const pipelineFailed = new sfn.Fail(this, 'PipelineFailed', {
      error: 'PipelineStepFailed',
      cause: 'See SNS alert email for step name and error details.',
    });

    const makeFailureNotifier = (stepName: string, id: string) =>
      new tasks.LambdaInvoke(this, id, {
        lambdaFunction: notifyFailureFn,
        payload: sfn.TaskInput.fromObject({
          'runId.$': '$.runId',
          'error.$': '$.error',
          step: stepName,
        }),
        resultPath: sfn.JsonPath.DISCARD,
      }).next(pipelineFailed);

    const notifyDownloadFailure = makeFailureNotifier('DownloadReports', 'NotifyDownloadFailure');
    const notifyParseFailure = makeFailureNotifier('ParseNormalize', 'NotifyParseFailure');
    const notifySyncFailure = makeFailureNotifier('SyncToHha', 'NotifySyncFailure');
    const notifyValidateFailure = makeFailureNotifier('ValidateAndNotify', 'NotifyValidateFailure');

    // Normalize input to { runId, dryRun }. Stubs are controlled via Lambda env PROVIDERSOFT_USE_STUBS.
    const mergeDefaults = new sfn.Pass(this, 'MergeDefaults', {
      parameters: {
        'runId.$': '$.runId',
        dryRun: false,
      },
    });

    const downloadTask = new tasks.LambdaInvoke(this, 'DownloadReports', {
      lambdaFunction: downloadFn,
      payload: sfn.TaskInput.fromObject({
        'runId.$': '$.runId',
        'dryRun.$': '$.dryRun',
      }),
      payloadResponseOnly: true,
      resultPath: '$.download',
      retryOnServiceExceptions: true,
    }).addRetry({
      errors: ['States.TaskFailed', 'Lambda.ServiceException'],
      interval: cdk.Duration.seconds(30),
      maxAttempts: 2,
      backoffRate: 2,
    });
    downloadTask.addCatch(notifyDownloadFailure, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const parseTask = new tasks.LambdaInvoke(this, 'ParseNormalize', {
      lambdaFunction: parseFn,
      payload: sfn.TaskInput.fromObject({
        'download.$': '$.download',
        'runId.$': '$.runId',
      }),
      payloadResponseOnly: true,
      resultPath: '$.parse',
    });
    parseTask.addCatch(notifyParseFailure, { errors: ['States.ALL'], resultPath: '$.error' });

    const openedBranch = new tasks.LambdaInvoke(this, 'OpenedBranch', {
      lambdaFunction: openedFn,
      payload: sfn.TaskInput.fromObject({
        'parse.$': '$.parse',
        'bucket.$': '$.download.bucket',
        'dryRun.$': '$.dryRun',
      }),
      payloadResponseOnly: true,
    });

    const closedBranch = new tasks.LambdaInvoke(this, 'ClosedBranch', {
      lambdaFunction: closedFn,
      payload: sfn.TaskInput.fromObject({
        'parse.$': '$.parse',
        'bucket.$': '$.download.bucket',
        'dryRun.$': '$.dryRun',
      }),
      payloadResponseOnly: true,
    });

    const sessionsBranch = new tasks.LambdaInvoke(this, 'SessionsBranch', {
      lambdaFunction: sessionsFn,
      payload: sfn.TaskInput.fromObject({
        'parse.$': '$.parse',
        'bucket.$': '$.download.bucket',
        'dryRun.$': '$.dryRun',
      }),
      payloadResponseOnly: true,
    });

    const parallelProcessors = new sfn.Parallel(this, 'SyncToHha', {
      resultSelector: {
        'opened.$': '$[0]',
        'closed.$': '$[1]',
        'sessions.$': '$[2]',
      },
      resultPath: '$.results',
    })
      .branch(openedBranch)
      .branch(closedBranch)
      .branch(sessionsBranch);
    parallelProcessors.addCatch(notifySyncFailure, { errors: ['States.ALL'], resultPath: '$.error' });

    const validateTask = new tasks.LambdaInvoke(this, 'ValidateAndNotify', {
      lambdaFunction: validateFn,
      payload: sfn.TaskInput.fromObject({
        'runId.$': '$.runId',
        'bucket.$': '$.download.bucket',
        'opened.$': '$.results.opened',
        'closed.$': '$.results.closed',
        'sessions.$': '$.results.sessions',
      }),
      payloadResponseOnly: true,
      resultPath: '$.validation',
    });
    validateTask.addCatch(notifyValidateFailure, { errors: ['States.ALL'], resultPath: '$.error' });

    // Input contract: { runId } (dryRun forced false for scheduled runs; override via console as needed)
    const definition = mergeDefaults
      .next(downloadTask)
      .next(parseTask)
      .next(parallelProcessors)
      .next(validateTask);

    const stateMachine = new sfn.StateMachine(this, 'PipelineStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, 'SfnLogs', {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ALL,
      },
    });

    if (enableDailySchedule) {
      new events.Rule(this, 'DailyPipelineSchedule', {
        schedule: events.Schedule.cron({ minute: '0', hour: '6' }),
        description: 'Daily White-glove ProviderSoft → HHA sync (06:00 UTC)',
        targets: [
          new targets.SfnStateMachine(stateMachine, {
            input: events.RuleTargetInput.fromObject({
              runId: events.EventField.fromPath('$.id'),
              dryRun: false,
            }),
          }),
        ],
      });
    }

    const pipelineConsoleUrl = `https://${this.region}.console.aws.amazon.com/states/home?region=${this.region}#/statemachines/view/${stateMachine.stateMachineArn}`;

    new cdk.CfnOutput(this, 'ReportsBucketName', { value: reportsBucket.bucketName });
    new cdk.CfnOutput(this, 'StateMachineArn', { value: stateMachine.stateMachineArn });
    new cdk.CfnOutput(this, 'PipelineConsoleUrl', {
      value: pipelineConsoleUrl,
      description: 'Manual run: open link → Start execution → use {"runId":"manual-YYYY-MM-DD"}',
    });
    new cdk.CfnOutput(this, 'ExceptionTopicArn', { value: exceptionTopic.topicArn });
    new cdk.CfnOutput(this, 'ProviderSoftSecretArn', { value: providerSoftSecret.secretArn });
    new cdk.CfnOutput(this, 'HhaSecretArn', { value: hhaSecret.secretArn });
    new cdk.CfnOutput(this, 'IdempotencyTableName', { value: idempotencyTable.tableName });
    new cdk.CfnOutput(this, 'ProviderSoftLiveBot', {
      value: providerSoftLiveBot ? 'true' : 'false',
      description:
        'When false, download Lambda is stub zip. Deploy with -c providerSoftLiveBot=true for Playwright.',
    });
    new cdk.CfnOutput(this, 'ProviderSoftUseStubs', {
      value: providerSoftUseStubs ? 'true' : 'false',
    });
  }
}
