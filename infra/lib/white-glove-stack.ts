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

    const alertEmail = this.node.tryGetContext('alertEmail') as string | undefined;

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
    if (alertEmail) {
      exceptionTopic.addSubscription(new subscriptions.EmailSubscription(alertEmail));
    }

    const sharedEnv: Record<string, string> = {
      REPORTS_BUCKET: reportsBucket.bucketName,
      IDEMPOTENCY_TABLE: idempotencyTable.tableName,
      EXCEPTION_TOPIC_ARN: exceptionTopic.topicArn,
      HHA_USE_MOCK: 'true',
      NODE_OPTIONS: '--enable-source-maps',
    };

    // Zip Lambda (stub reports) — no Docker required for bootstrap/deploy.
    // Switch back to DockerImageFunction + Playwright when ProviderSoft live login is ready.
    const bundling = {
      minify: true,
      sourceMap: true,
      target: 'node20',
      format: OutputFormat.ESM,
      banner:
        "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      mainFields: ['module', 'main'] as string[],
      externalModules: ['playwright', 'playwright-core', '@playwright/test'],
    };

    const downloadFn = new NodejsFunction(this, 'ProviderSoftDownloadFn', {
      entry: path.join(repoRoot, 'packages/providersoft-bot/src/stub-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        ...sharedEnv,
        PROVIDERSOFT_SECRET_ARN: providerSoftSecret.secretArn,
        PROVIDERSOFT_USE_STUBS: 'true',
      },
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

    const parseTask = new tasks.LambdaInvoke(this, 'ParseNormalize', {
      lambdaFunction: parseFn,
      payload: sfn.TaskInput.fromObject({
        'download.$': '$.download',
        'runId.$': '$.runId',
      }),
      payloadResponseOnly: true,
      resultPath: '$.parse',
    });

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

    new cdk.CfnOutput(this, 'ReportsBucketName', { value: reportsBucket.bucketName });
    new cdk.CfnOutput(this, 'StateMachineArn', { value: stateMachine.stateMachineArn });
    new cdk.CfnOutput(this, 'ExceptionTopicArn', { value: exceptionTopic.topicArn });
    new cdk.CfnOutput(this, 'ProviderSoftSecretArn', { value: providerSoftSecret.secretArn });
    new cdk.CfnOutput(this, 'HhaSecretArn', { value: hhaSecret.secretArn });
    new cdk.CfnOutput(this, 'IdempotencyTableName', { value: idempotencyTable.tableName });
  }
}
