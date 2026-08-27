import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { ProviderSoftBotImage } from './providersoft-bot-image.js';
import { HhaSessionsBotImage } from './hha-sessions-bot-image.js';

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
    const alertFromEmail = String(
      this.node.tryGetContext('alertFromEmail') ??
        (this.node.tryGetContext('alertFromDomain')
          ? `alerts@${this.node.tryGetContext('alertFromDomain')}`
          : alertEmails[0] ?? 'alerts@whiteglovecare.net'),
    );
    const alertFromName = String(
      this.node.tryGetContext('alertFromName') ?? 'White Glove Alerts',
    );
    const alertFromEmailFallback = String(
      this.node.tryGetContext('alertFromEmailFallback') ?? 'moshe@advancedautomations.net',
    );
    const alertFromDomain = this.node.tryGetContext('alertFromDomain') as string | undefined;

    /**
     * Customer-managed KMS key for PHI-adjacent stores (S3, DynamoDB, Secrets, SNS, SFN logs).
     * Rotation enabled; retain on stack delete so ciphertext remains recoverable.
     */
    const dataKey = new kms.Key(this, 'DataEncryptionKey', {
      alias: 'alias/white-glove-data',
      description: 'White-glove CMK for reports, audit logs, secrets, SNS, DynamoDB, SFN logs',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    dataKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudTrailEncrypt',
        principals: [new iam.ServicePrincipal('cloudtrail.amazonaws.com')],
        actions: ['kms:GenerateDataKey*', 'kms:DescribeKey'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: {
            'aws:SourceArn': `arn:aws:cloudtrail:${this.region}:${this.account}:trail/*`,
          },
        },
      }),
    );
    dataKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudWatchLogs',
        principals: [new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`)],
        actions: [
          'kms:Encrypt*',
          'kms:Decrypt*',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:Describe*',
        ],
        resources: ['*'],
        conditions: {
          ArnLike: {
            'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:${this.region}:${this.account}:*`,
          },
        },
      }),
    );

    /** Audit logs: CloudTrail + S3 server access logs for WGCC compliance. */
    const auditBucket = new s3.Bucket(this, 'AuditBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'expire-audit-logs',
          expiration: cdk.Duration.days(
            Number(this.node.tryGetContext('auditLogRetentionDays') ?? 365),
          ),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const reportsBucket = new s3.Bucket(this, 'ReportsBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: auditBucket,
      serverAccessLogsPrefix: 'reports-access/',
      lifecycleRules: [
        {
          id: 'expire-old-runs',
          expiration: cdk.Duration.days(
            Number(this.node.tryGetContext('reportsRetentionDays') ?? 7),
          ),
          noncurrentVersionExpiration: cdk.Duration.days(3),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cloudtrail.Trail(this, 'AuditTrail', {
      trailName: 'white-glove-audit',
      bucket: auditBucket,
      encryptionKey: dataKey,
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      enableFileValidation: true,
      sendToCloudWatchLogs: false,
    });

    /** GuardDuty on by default for HIPAA-oriented monitoring; set -c enableGuardDuty=false to skip. */
    if (String(this.node.tryGetContext('enableGuardDuty') ?? 'true') === 'true') {
      new guardduty.CfnDetector(this, 'GuardDutyDetector', {
        enable: true,
        findingPublishingFrequency: 'SIX_HOURS',
      });
    }

    const idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
    });

    const providerSoftSecret = new secretsmanager.Secret(this, 'ProviderSoftSecret', {
      description: 'ProviderSoft login credentials (baseUrl, username, password)',
      encryptionKey: dataKey,
      secretObjectValue: {
        baseUrl: cdk.SecretValue.unsafePlainText('https://CHANGE_ME.providersoft.com'),
        username: cdk.SecretValue.unsafePlainText('CHANGE_ME'),
        password: cdk.SecretValue.unsafePlainText('CHANGE_ME'),
      },
    });

    /**
     * Import the live HHA secret — do NOT let CloudFormation manage SecretString.
     * (Managed secrets get regenerated on deploy and wipe MFA cookies + credentials.)
     * Imported secrets keep their existing KMS key; rotate to the stack CMK manually if required.
     */
    const hhaSecretArn = String(this.node.tryGetContext('hhaSecretArn') ?? '').trim();
    const hhaSecret = hhaSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(this, 'HhaSecret', hhaSecretArn)
      : new secretsmanager.Secret(this, 'HhaSecret', {
          description:
            'HHA SOAP + ENT AppSync (refresh entSpaAccessToken via npm run hha:get-spa-token)',
          encryptionKey: dataKey,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

    const exceptionTopic = new sns.Topic(this, 'ExceptionTopic', {
      displayName: 'White-glove pipeline exceptions',
      masterKey: dataKey,
    });
    /** HTML alerts go via SES; SNS topic is plain-text fallback if SES fails. */
    for (const email of alertEmails) {
      exceptionTopic.addSubscription(new subscriptions.EmailSubscription(email));
    }

    if (alertFromDomain?.trim()) {
      const domain = alertFromDomain.trim();
      const domainIdentity = new ses.EmailIdentity(this, 'AlertFromDomain', {
        identity: ses.Identity.domain(domain),
        mailFromDomain: `mail.${domain}`,
      });
      new cdk.CfnOutput(this, 'AlertSesDkimRecords', {
        value: [
          domainIdentity.dkimDnsTokenName1,
          domainIdentity.dkimDnsTokenName2,
          domainIdentity.dkimDnsTokenName3,
        ]
          .filter(Boolean)
          .join(','),
        description: `Add SES Easy DKIM CNAMEs for ${domain} (AWS SES console → Identities)`,
      });
      new cdk.CfnOutput(this, 'AlertSesMailFromDomain', {
        value: `mail.${domain}`,
        description: 'Optional MX + SPF for MAIL FROM subdomain (improves DMARC alignment)',
      });
    }

    /** From-address identity usually already exists in SES — only create when explicitly asked. */
    if (String(this.node.tryGetContext('manageSesFromIdentity') ?? 'false') === 'true') {
      new ses.EmailIdentity(this, 'AlertFromEmail', {
        identity: ses.Identity.email(alertFromEmail),
      });
    }

    /** Recipient/fallback SES identities are created manually in the console — do not manage here (already exist). */

    const hhaUseMock = String(this.node.tryGetContext('hhaUseMock') ?? 'false') === 'true';

    const hhaProductionUrl =
      'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';

    const sharedEnv: Record<string, string> = {
      REPORTS_BUCKET: reportsBucket.bucketName,
      IDEMPOTENCY_TABLE: idempotencyTable.tableName,
      EXCEPTION_TOPIC_ARN: exceptionTopic.topicArn,
      ALERT_FROM_EMAIL: alertFromEmail,
      ALERT_FROM_EMAIL_FALLBACK: alertFromEmailFallback,
      ALERT_FROM_NAME: alertFromName,
      ALERT_EMAILS: alertEmails.join(','),
      HHA_USE_MOCK: hhaUseMock ? 'true' : 'false',
      HHA_PRODUCTION_BASE_URL: hhaProductionUrl,
      /** Pipeline uses production HHA SOAP (writes still gated by dryRun). */
      HHA_USE_PRODUCTION: 'true',
      HHA_ALLOW_PRODUCTION: 'true',
      NODE_OPTIONS: '--enable-source-maps',
    };

    // Download Lambda:
    // - Default: zip stub (no Docker on laptop)
    // - Production bot: ECR image built by AWS CodeBuild (scripts/build-bot-image-aws.mjs)
    // - Deploy live: cdk deploy -c providerSoftLiveBot=true -c providerSoftUseStubs=false
    const providerSoftLiveBot =
      String(this.node.tryGetContext('providerSoftLiveBot') ?? 'false') === 'true';
    const providerSoftUseStubs =
      String(this.node.tryGetContext('providerSoftUseStubs') ?? 'true') === 'true';
    const hhaEntLiveBot =
      String(this.node.tryGetContext('hhaEntLiveBot') ?? 'false') === 'true';

    const botImage = new ProviderSoftBotImage(this, 'ProviderSoftBotImage', { repoRoot });
    const hhaSessionsBot = new HhaSessionsBotImage(this, 'HhaSessionsBotImage', { repoRoot });
    const enableNightSchedule =
      String(this.node.tryGetContext('enableNightSchedule') ?? 'false') === 'true';
    const enableSessionsSchedule =
      String(this.node.tryGetContext('enableSessionsSchedule') ?? 'false') === 'true';
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
      /** HTTP-primary (Gender: columns); Playwright remains fallback. Set true only to debug UI path. */
      PROVIDERSOFT_PREFER_PLAYWRIGHT: 'false',
      PROVIDERSOFT_REPORT_OPENED_ID: '4566',
      PROVIDERSOFT_REPORT_CLOSED_ID: '4527',
      PROVIDERSOFT_REPORT_DISCHARGE_ID: '4528',
      PROVIDERSOFT_REPORT_SESSIONS_ID: '4026',
      PROVIDERSOFT_REPORT_CAREGIVER_CODES_ID: '4541',
      /** Gender:-enabled rebuilt report (was 4559 / Real DOB). */
      PROVIDERSOFT_REPORT_NEW_SERVICES_ID: '4559',
      PROVIDERSOFT_REPORT_KINDS: 'opened_cases,closed_cases,verified_sessions',
      /** Nightly ~11 PM Eastern: filter today's intake / closure / discharge dates; new service uses 14-day begin-date window. */
      PROVIDERSOFT_DAILY_LOOKBACK_DAYS: '0',
      PROVIDERSOFT_TIMEZONE: 'America/New_York',
    };

    const downloadFn: lambda.IFunction = providerSoftLiveBot
      ? new lambda.DockerImageFunction(this, 'ProviderSoftDownloadFn', {
          code: lambda.DockerImageCode.fromEcr(botImage.repository, {
            tagOrDigest: 'latest',
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

    const sandboxFixtureDownloadFn = new NodejsFunction(this, 'SandboxFixtureDownloadFn', {
      entry: path.join(repoRoot, 'packages/processors/src/handlers/sandbox-fixture-download.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: sharedEnv,
      bundling,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      projectRoot: repoRoot,
    });
    reportsBucket.grantReadWrite(sandboxFixtureDownloadFn);

    const makeProcessor = (
      functionId: string,
      entry: string,
      extraEnv: Record<string, string> = {},
      timeout = cdk.Duration.minutes(5),
    ) => {
      const fn = new NodejsFunction(this, functionId, {
        entry: path.join(repoRoot, entry),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        timeout,
        memorySize: 1024,
        environment: {
          ...sharedEnv,
          HHA_SECRET_ARN: hhaSecret.secretArn,
          ...extraEnv,
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
    const openedFn = makeProcessor(
      'OpenedFn',
      'packages/processors/src/handlers/opened.ts',
      {},
      cdk.Duration.minutes(15),
    );
    const closedFn = makeProcessor(
      'ClosedFn',
      'packages/processors/src/handlers/closed.ts',
      {},
      cdk.Duration.minutes(15),
    );
    const sessionsFnEnv: Record<string, string> = {
      HHA_ENT_GRAPHQL_ENABLED: 'true',
      HHA_ENT_AUTO_LOGIN: 'true',
      HHA_ENT_COORDINATOR_ID: String(
        this.node.tryGetContext('hhaEntCoordinatorId') ?? '68033,67321',
      ),
      HHA_ENT_COORDINATOR_NAMES: String(
        this.node.tryGetContext('hhaEntCoordinatorNames') ?? 'Billu Markowitz,Grace Greenfeld',
      ),
      HHA_ENT_USER_ID: String(this.node.tryGetContext('hhaEntUserId') ?? '217884'),
      HHA_ENT_PROVIDER_ID: String(this.node.tryGetContext('hhaEntProviderId') ?? '613'),
      HHA_ENT_OFFICE_IDS: String(
        this.node.tryGetContext('hhaEntOfficeIds') ??
          '2259,2933,7362,13511,15453,16039,1025',
      ),
    };

    const sessionsFn: lambda.IFunction = hhaEntLiveBot
      ? new lambda.DockerImageFunction(this, 'SessionsFn', {
          code: lambda.DockerImageCode.fromEcr(hhaSessionsBot.repository, {
            tagOrDigest: 'latest',
          }),
          timeout: cdk.Duration.minutes(15),
          memorySize: 3008,
          ephemeralStorageSize: cdk.Size.mebibytes(2048),
          environment: {
            ...sharedEnv,
            ...sessionsFnEnv,
            HHA_SECRET_ARN: hhaSecret.secretArn,
          },
          architecture: lambda.Architecture.X86_64,
        })
      : makeProcessor('SessionsFn', 'packages/processors/src/handlers/sessions.ts', sessionsFnEnv);

    reportsBucket.grantReadWrite(sessionsFn);
    idempotencyTable.grantReadWriteData(sessionsFn);
    hhaSecret.grantRead(sessionsFn);
    hhaSecret.grantWrite(sessionsFn);
    exceptionTopic.grantPublish(sessionsFn);
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

    const mergeDefaultsFn = new NodejsFunction(this, 'MergeDefaultsFn', {
      entry: path.join(repoRoot, 'packages/processors/src/handlers/merge-pipeline-input.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: sharedEnv,
      bundling,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      projectRoot: repoRoot,
    });

    const bumpSyncRetryFn = new NodejsFunction(this, 'BumpSyncRetryFn', {
      entry: path.join(repoRoot, 'packages/processors/src/handlers/bump-sync-retry.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: sharedEnv,
      bundling,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      projectRoot: repoRoot,
    });

    const sesSendPolicy = new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    });
    validateFn.addToRolePolicy(sesSendPolicy);
    notifyFailureFn.addToRolePolicy(sesSendPolicy);

    const pipelineFailed = new sfn.Fail(this, 'PipelineFailed', {
      error: 'PipelineStepFailed',
      cause: 'See alert email for step name and error details.',
    });

    const catchToFailed = (id: string) =>
      new sfn.Pass(this, id, {
        parameters: {
          'runId.$': '$.runId',
          'error.$': '$.error',
        },
        resultPath: '$',
      }).next(pipelineFailed);

    const mergeDefaults = new tasks.LambdaInvoke(this, 'MergeDefaults', {
      lambdaFunction: mergeDefaultsFn,
      payloadResponseOnly: true,
      outputPath: '$',
    });
    mergeDefaults.addCatch(catchToFailed('MergeDefaultsFailed'), {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const downloadPayload = {
      'runId.$': '$.runId',
      'dryRun.$': '$.dryRun',
      'sandbox.$': '$.sandbox',
      'sandboxEmailFixtures.$': '$.sandboxEmailFixtures',
      'sandboxLiveFixtures.$': '$.sandboxLiveFixtures',
      'reportKinds.$': '$.reportKinds',
      'dateRanges.$': '$.dateRanges',
    };

    const downloadTask = new tasks.LambdaInvoke(this, 'DownloadReports', {
      lambdaFunction: downloadFn,
      payload: sfn.TaskInput.fromObject(downloadPayload),
      payloadResponseOnly: true,
      resultPath: '$.download',
      retryOnServiceExceptions: true,
    }).addRetry({
      errors: ['States.TaskFailed', 'Lambda.ServiceException'],
      interval: cdk.Duration.seconds(30),
      maxAttempts: 2,
      backoffRate: 2,
    });
    downloadTask.addCatch(catchToFailed('DownloadFailed'), {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const fixtureDownloadTask = new tasks.LambdaInvoke(this, 'SandboxFixtureDownload', {
      lambdaFunction: sandboxFixtureDownloadFn,
      payload: sfn.TaskInput.fromObject({
        'runId.$': '$.runId',
        'sandbox.$': '$.sandbox',
        'sandboxEmailFixtures.$': '$.sandboxEmailFixtures',
        'sandboxLiveFixtures.$': '$.sandboxLiveFixtures',
      }),
      payloadResponseOnly: true,
      resultPath: '$.download',
    });
    fixtureDownloadTask.addCatch(catchToFailed('FixtureDownloadFailed'), {
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
    parseTask.addCatch(catchToFailed('ParseFailed'), { errors: ['States.ALL'], resultPath: '$.error' });

    const processorBranchFallback = (id: string, reportKind: string, label: string) =>
      new sfn.Pass(this, id, {
        parameters: {
          'runId.$': '$.parse.runId',
          reportKind,
          processed: 0,
          succeeded: 0,
          skipped: 0,
          failed: 1,
          timedOut: true,
          exceptions: [
            {
              code: 'pipeline_step_error',
              message: `${label} timed out or crashed. Other HHA branches still completed. Rows already written to HHA were kept — pipeline will auto-retry remaining rows if attempts remain.`,
              reportKind,
              details: { timedOut: true, branchCrashed: true },
            },
          ],
        },
      });

    const openedBranch = new tasks.LambdaInvoke(this, 'OpenedBranch', {
      lambdaFunction: openedFn,
      payload: sfn.TaskInput.fromObject({
        'parse.$': '$.parse',
        'bucket.$': '$.download.bucket',
        'dryRun.$': '$.dryRun',
        'sandboxLiveFixtures.$': '$.sandboxLiveFixtures',
      }),
      payloadResponseOnly: true,
    });
    openedBranch.addCatch(processorBranchFallback('OpenedBranchFailed', 'opened_cases', 'Opened HHA sync'), {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const closedBranch = new tasks.LambdaInvoke(this, 'ClosedBranch', {
      lambdaFunction: closedFn,
      payload: sfn.TaskInput.fromObject({
        'parse.$': '$.parse',
        'bucket.$': '$.download.bucket',
        'dryRun.$': '$.dryRun',
        'sandboxLiveFixtures.$': '$.sandboxLiveFixtures',
      }),
      payloadResponseOnly: true,
    });
    closedBranch.addCatch(processorBranchFallback('ClosedBranchFailed', 'closed_cases', 'Closed HHA sync'), {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const sessionsBranch = new tasks.LambdaInvoke(this, 'SessionsBranch', {
      lambdaFunction: sessionsFn,
      payload: sfn.TaskInput.fromObject({
        'parse.$': '$.parse',
        'bucket.$': '$.download.bucket',
        'dryRun.$': '$.dryRun',
        'sandboxLiveFixtures.$': '$.sandboxLiveFixtures',
      }),
      payloadResponseOnly: true,
    });
    sessionsBranch.addCatch(
      processorBranchFallback('SessionsBranchFailed', 'verified_sessions', 'Sessions HHA sync'),
      {
        errors: ['States.ALL'],
        resultPath: '$.error',
      },
    );

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
    parallelProcessors.addCatch(catchToFailed('SyncFailed'), { errors: ['States.ALL'], resultPath: '$.error' });

    const bumpSyncRetry = new tasks.LambdaInvoke(this, 'BumpSyncRetry', {
      lambdaFunction: bumpSyncRetryFn,
      payloadResponseOnly: true,
      outputPath: '$',
    });
    bumpSyncRetry.addCatch(catchToFailed('BumpSyncRetryFailed'), {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });
    bumpSyncRetry.next(parallelProcessors);

    const validateTask = new tasks.LambdaInvoke(this, 'ValidateAndNotify', {
      lambdaFunction: validateFn,
      payload: sfn.TaskInput.fromObject({
        'runId.$': '$.runId',
        'dryRun.$': '$.dryRun',
        'sandbox.$': '$.sandbox',
        'sandboxEmailFixtures.$': '$.sandboxEmailFixtures',
        'bucket.$': '$.download.bucket',
        'parse.$': '$.parse',
        'opened.$': '$.results.opened',
        'closed.$': '$.results.closed',
        'sessions.$': '$.results.sessions',
      }),
      payloadResponseOnly: true,
      resultPath: '$.validation',
    });
    validateTask.addCatch(catchToFailed('ValidateFailed'), { errors: ['States.ALL'], resultPath: '$.error' });

    /** Choice booleanEquals crashes if the JSONPath is missing — require IsPresent first. */
    const flagIsTrue = (path: string) =>
      sfn.Condition.and(sfn.Condition.isPresent(path), sfn.Condition.booleanEquals(path, true));

    /** Soft-timeout / branch kill: re-run SyncToHha (idempotent) up to 2 more times before emailing. */
    const continueAfterTimeout = new sfn.Choice(this, 'ContinueAfterTimeout')
      .when(
        sfn.Condition.and(
          sfn.Condition.numberLessThan('$.syncRetryCount', 2),
          sfn.Condition.or(
            flagIsTrue('$.results.opened.timedOut'),
            flagIsTrue('$.results.closed.timedOut'),
            flagIsTrue('$.results.sessions.timedOut'),
          ),
        ),
        bumpSyncRetry,
      )
      .otherwise(validateTask);

    parseTask.next(parallelProcessors).next(continueAfterTimeout);

    downloadTask.next(parseTask);
    fixtureDownloadTask.next(parseTask);

    const chooseDownloadMode = new sfn.Choice(this, 'ChooseDownloadMode')
      .when(
        sfn.Condition.and(
          flagIsTrue('$.sandbox'),
          sfn.Condition.or(flagIsTrue('$.sandboxEmailFixtures'), flagIsTrue('$.sandboxLiveFixtures')),
        ),
        fixtureDownloadTask,
      )
      .otherwise(downloadTask);

    // Input contract: { runId } (dryRun forced false for scheduled runs; override via console as needed)
    const definition = mergeDefaults.next(chooseDownloadMode);

    const stateMachine = new sfn.StateMachine(this, 'PipelineStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(60),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, 'SfnLogs', {
          retention: logs.RetentionDays.ONE_MONTH,
          encryptionKey: dataKey,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ALL,
      },
    });

    // Email on any execution failure (including states without Catch, e.g. early runtime errors).
    new events.Rule(this, 'PipelineExecutionFailedRule', {
      description: 'Alert when White-glove pipeline Step Functions execution fails',
      eventPattern: {
        source: ['aws.states'],
        detailType: ['Step Functions Execution Status Change'],
        detail: {
          status: ['FAILED'],
          stateMachineArn: [stateMachine.stateMachineArn],
        },
      },
      targets: [new targets.LambdaFunction(notifyFailureFn)],
    });

    if (enableDailySchedule) {
      new events.Rule(this, 'DailyPipelineSchedule', {
        schedule: events.Schedule.cron({ minute: '0', hour: '6' }),
        description: 'Legacy daily sync (06:00 UTC) — prefer enableNightSchedule',
        targets: [
          new targets.SfnStateMachine(stateMachine, {
            input: events.RuleTargetInput.fromObject({
              runId: events.EventField.fromPath('$.id'),
              dryRun: false,
              sandbox: false,
              sandboxEmailFixtures: false,
              sandboxLiveFixtures: false,
            }),
          }),
        ],
      });
    }

    // Live schedules are always provisioned (DISABLED by default). The MFA dashboard
    // toggles EventBridge State via enable-rule / disable-rule. CDK deploys reset State
    // to DISABLED (safe default). Monday dry-run preview stays opt-in and is NOT toggled.
    const nightlyCaseReportsRule = this.addEasternNightSchedule(this, 'NightlyCaseReportsSchedule', {
      weekDay: 'MON-SUN',
      /** 21:00 UTC ≈ 5:00 PM EDT (4:00 PM EST). */
      hour: 21,
      description: 'Nightly Gluck open + closure / new services / discharge (~5:00 PM Eastern)',
      enabled: false,
      stateMachine,
      input: {
        runId: events.EventField.fromPath('$.id'),
        dryRun: false,
        reportKinds: ['opened_cases', 'closed_cases', 'discharge_service', 'new_services'],
      },
    });

    const tuesdaySessionsRule = this.addEasternNightSchedule(this, 'TuesdaySessionsSchedule', {
      weekDay: 'TUE',
      description: 'Tuesday night live verified sessions / API Report (11:00 PM Eastern)',
      enabled: false,
      stateMachine,
      input: {
        runId: events.EventField.fromPath('$.id'),
        dryRun: false,
        reportKinds: ['verified_sessions', 'caregiver_codes'],
      },
    });

    if (enableNightSchedule) {
      this.addEasternNightSchedule(this, 'MondayPreviewSchedule', {
        weekDay: 'MON',
        description: 'Monday night dry-run — flag missing mappings (11:00 PM Eastern)',
        enabled: true,
        stateMachine,
        input: {
          runId: events.EventField.fromPath('$.id'),
          dryRun: true,
          reportKinds: enableSessionsSchedule
            ? [
                'opened_cases',
                'closed_cases',
                'new_services',
                'verified_sessions',
                'caregiver_codes',
              ]
            : ['opened_cases', 'closed_cases', 'new_services', 'caregiver_codes'],
        },
      });
    }

    const pipelineConsoleUrl = `https://${this.region}.console.aws.amazon.com/states/home?region=${this.region}#/statemachines/view/${stateMachine.stateMachineArn}`;

    const sandboxApiKey = String(this.node.tryGetContext('sandboxApiKey') ?? '');
    const sandboxTriggerFn = new NodejsFunction(this, 'SandboxTriggerFn', {
      entry: path.join(repoRoot, 'packages/processors/src/handlers/sandbox-trigger.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        SANDBOX_API_KEY: sandboxApiKey,
        PIPELINE_CONSOLE_URL: pipelineConsoleUrl,
      },
      bundling,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      projectRoot: repoRoot,
    });
    stateMachine.grantStartExecution(sandboxTriggerFn);
    const sandboxFunctionUrl = sandboxTriggerFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new cdk.CfnOutput(this, 'ReportsBucketName', { value: reportsBucket.bucketName });
    new cdk.CfnOutput(this, 'AuditBucketName', { value: auditBucket.bucketName });
    new cdk.CfnOutput(this, 'CloudTrailName', { value: 'white-glove-audit' });
    new cdk.CfnOutput(this, 'StateMachineArn', { value: stateMachine.stateMachineArn });
    new cdk.CfnOutput(this, 'SandboxTriggerUrl', {
      value: sandboxApiKey
        ? `${sandboxFunctionUrl.url}?key=${sandboxApiKey}`
        : sandboxFunctionUrl.url,
      description:
        'Bookmark to start sandbox run (real PS + prod HHA read-only, email summary). Set -c sandboxApiKey=… on deploy.',
    });
    new cdk.CfnOutput(this, 'SandboxApiKeyConfigured', {
      value: sandboxApiKey ? 'true' : 'false',
    });

    // Manual LIVE start — same key as sandbox; requires confirm=LIVE. Does not enable EventBridge crons.
    const liveApiKey = String(this.node.tryGetContext('liveApiKey') ?? sandboxApiKey);
    const liveTriggerFn = new NodejsFunction(this, 'LiveTriggerFn', {
      entry: path.join(repoRoot, 'packages/processors/src/handlers/live-trigger.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        LIVE_API_KEY: liveApiKey,
        PIPELINE_CONSOLE_URL: pipelineConsoleUrl,
      },
      bundling,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      projectRoot: repoRoot,
    });
    stateMachine.grantStartExecution(liveTriggerFn);
    const liveFunctionUrl = liveTriggerFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });
    new cdk.CfnOutput(this, 'LiveTriggerUrl', {
      value: liveApiKey
        ? `${liveFunctionUrl.url}?key=${liveApiKey}&confirm=LIVE`
        : `${liveFunctionUrl.url}?confirm=LIVE`,
      description:
        'MANUAL live sessions (verified_sessions + caregiver_codes only; dryRun=false, sandbox=false). Requires confirm=LIVE. Does not enable nightly schedules.',
    });
    new cdk.CfnOutput(this, 'LiveApiKeyConfigured', {
      value: liveApiKey ? 'true' : 'false',
    });

    const dashboardApiKey = String(this.node.tryGetContext('dashboardApiKey') ?? sandboxApiKey);
    const cookiesSecretArn = String(this.node.tryGetContext('hhaCookiesSecretArn') ?? '');
    const mfaDashboardFn = new NodejsFunction(this, 'MfaDashboardFn', {
      entry: path.join(repoRoot, 'packages/processors/src/handlers/mfa-dashboard-api.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: {
        ...sharedEnv,
        HHA_SECRET_ARN: hhaSecret.secretArn,
        DASHBOARD_API_KEY: dashboardApiKey,
        SANDBOX_API_KEY: sandboxApiKey,
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        PIPELINE_CONSOLE_URL: pipelineConsoleUrl,
        LIVE_SCHEDULE_NIGHTLY_RULE: nightlyCaseReportsRule.ruleName,
        LIVE_SCHEDULE_TUESDAY_RULE: tuesdaySessionsRule.ruleName,
        ...(cookiesSecretArn ? { HHA_ENT_COOKIES_SECRET_ARN: cookiesSecretArn } : {}),
      },
      bundling,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      projectRoot: repoRoot,
    });
    stateMachine.grantStartExecution(mfaDashboardFn);
    hhaSecret.grantRead(mfaDashboardFn);
    hhaSecret.grantWrite(mfaDashboardFn);
    reportsBucket.grantReadWrite(mfaDashboardFn, 'mfa-pending/*');
    // Last-week summary reads validate-summary.json under runs/*
    reportsBucket.grantRead(mfaDashboardFn, 'runs/*');
    mfaDashboardFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:DescribeRule', 'events:EnableRule', 'events:DisableRule'],
        resources: [nightlyCaseReportsRule.ruleArn, tuesdaySessionsRule.ruleArn],
      }),
    );
    if (cookiesSecretArn) {
      const cookiesSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'HhaCookiesSecret',
        cookiesSecretArn,
      );
      cookiesSecret.grantRead(mfaDashboardFn);
      cookiesSecret.grantWrite(mfaDashboardFn);
    }
    const mfaDashboardUrl = mfaDashboardFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });
    new cdk.CfnOutput(this, 'MfaDashboardApiUrl', {
      value: dashboardApiKey
        ? `${mfaDashboardUrl.url}?key=${dashboardApiKey}&action=status`
        : mfaDashboardUrl.url,
      description: 'White Glove dashboard API (MFA renew + status). Set -c dashboardApiKey=…',
    });
    new cdk.CfnOutput(this, 'MfaDashboardUiUrl', {
      value: dashboardApiKey
        ? `${mfaDashboardUrl.url}?key=${dashboardApiKey}&action=ui`
        : `${mfaDashboardUrl.url}?action=ui`,
      description:
        'Ops dashboard UI: MFA renew + Test live (report pickers + per-report dates). Does not enable nightly schedules.',
    });

    new cdk.CfnOutput(this, 'AlertEmails', {
      value: alertEmails.join(', ') || '(none — set -c alertEmails=)',
    });
    new cdk.CfnOutput(this, 'HhaProductionSoapUrl', {
      value: sharedEnv.HHA_PRODUCTION_BASE_URL!,
      description: 'Production HHA SOAP URL used for sandbox read-only lookups',
    });
    new cdk.CfnOutput(this, 'PipelineConsoleUrl', {
      value: pipelineConsoleUrl,
      description: 'Manual run: open link → Start execution → use {"runId":"manual-YYYY-MM-DD"}',
    });
    new cdk.CfnOutput(this, 'ExceptionTopicArn', { value: exceptionTopic.topicArn });
    new cdk.CfnOutput(this, 'DataEncryptionKeyArn', {
      value: dataKey.keyArn,
      description: 'CMK used for S3/DynamoDB/Secrets/SNS/SFN logs (alias/white-glove-data)',
    });
    new cdk.CfnOutput(this, 'ProviderSoftSecretArn', { value: providerSoftSecret.secretArn });
    new cdk.CfnOutput(this, 'HhaSecretArn', { value: hhaSecret.secretArn });
    new cdk.CfnOutput(this, 'IdempotencyTableName', { value: idempotencyTable.tableName });
    new cdk.CfnOutput(this, 'ProviderSoftLiveBot', {
      value: providerSoftLiveBot ? 'true' : 'false',
      description:
        'When false, download Lambda uses stub zip. Live image is built only by deploy:aws:live / bot:deploy:aws — plain cdk deploy does not rebuild ECR.',
    });
    new cdk.CfnOutput(this, 'ProviderSoftUseStubs', {
      value: providerSoftUseStubs ? 'true' : 'false',
    });
    new cdk.CfnOutput(this, 'BotEcrRepositoryUri', {
      value: botImage.repository.repositoryUri,
      description: 'ECR repo for Playwright bot — image built by CodeBuild in AWS',
    });
    new cdk.CfnOutput(this, 'BotSourceBucketName', {
      value: botImage.sourceBucket.bucketName,
      description: 'Upload source.zip here before CodeBuild (or use scripts/build-bot-image-aws.mjs)',
    });
    new cdk.CfnOutput(this, 'BotCodeBuildProjectName', {
      value: botImage.project.projectName,
      description: 'CodeBuild project that builds the bot Docker image (no local Docker)',
    });
    new cdk.CfnOutput(this, 'BotBootstrapFunctionName', {
      value: botImage.bootstrapFn.functionName,
      description: 'Invoke to download GitHub source + start CodeBuild: npm run bot:deploy:aws',
    });
    new cdk.CfnOutput(this, 'HhaEntLiveBot', {
      value: hhaEntLiveBot ? 'true' : 'false',
      description:
        'When true, SessionsFn uses Playwright Docker. Build: npm run hha:sessions:deploy:aws',
    });
    new cdk.CfnOutput(this, 'HhaSessionsBotEcrRepositoryUri', {
      value: hhaSessionsBot.repository.repositoryUri,
    });
    new cdk.CfnOutput(this, 'HhaSessionsBotBootstrapFunctionName', {
      value: hhaSessionsBot.bootstrapFn.functionName,
    });
    new cdk.CfnOutput(this, 'HhaSessionsBotCodeBuildProjectName', {
      value: hhaSessionsBot.project.projectName,
    });
  }

  /**
   * Eastern-intent cron via fixed UTC hour (account EventBridge rejects ScheduleExpressionTimezone).
   * Default hour 3 → ~11:00 PM EDT / ~10:00 PM EST.
   * Nightly cases pass hour 21 → ~5:00 PM EDT / ~4:00 PM EST.
   */
  private addEasternNightSchedule(
    scope: Construct,
    id: string,
    props: {
      weekDay: string;
      description: string;
      stateMachine: sfn.IStateMachine;
      input: Record<string, unknown>;
      /** UTC hour (0–23). Default 3 ≈ 11 PM EDT. */
      hour?: number;
      /** Defaults to true (EventBridge / CDK default). Live toggle rules pass false. */
      enabled?: boolean;
    },
  ): events.Rule {
    const hour = props.hour ?? 3;
    return new events.Rule(scope, id, {
      schedule: events.Schedule.cron({
        minute: '0',
        hour: String(hour),
        weekDay: props.weekDay,
      }),
      description: `${props.description} (${String(hour).padStart(2, '0')}:00 UTC)`,
      enabled: props.enabled ?? true,
      targets: [
        new targets.SfnStateMachine(props.stateMachine, {
          input: events.RuleTargetInput.fromObject({
            sandbox: false,
            sandboxEmailFixtures: false,
            sandboxLiveFixtures: false,
            ...props.input,
          }),
        }),
      ],
    });
  }
}
