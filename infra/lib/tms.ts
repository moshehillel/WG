import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../..');

export function addTherapyManagement(
  scope: Construct,
  props: {
    reportsBucket: s3.IBucket;
    hhaSecret: secretsmanager.ISecret;
    /** CMK used for TMS DynamoDB (same stack data key). */
    encryptionKey: kms.IKey;
    fromEmail?: string;
    bedrockModelId?: string;
    spaOrigin?: string;
    internalKey?: string;
    /** OpenAI key for Luna — optional CDK seed; preferred live store is Secrets Manager (see TmsLunaOpenAiSecret). */
    openaiApiKey?: string;
    lunaSupportEmail?: string;
    openaiModel?: string;
  },
): { apiUrl: lambda.FunctionUrl; userPool: cognito.UserPool; stateTable: dynamodb.Table } {
  const userPool = new cognito.UserPool(scope, 'TmsUserPool', {
    userPoolName: 'white-glove-tms',
    selfSignUpEnabled: false,
    signInAliases: { email: true },
    accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    // Match SPA copy: 8+ chars with upper, lower, number (no symbol required).
    passwordPolicy: {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireDigits: true,
      requireSymbols: false,
    },
    removalPolicy: cdk.RemovalPolicy.RETAIN,
  });
  const adminGroup = new cognito.CfnUserPoolGroup(scope, 'TmsAdminGroup', {
    userPoolId: userPool.userPoolId,
    groupName: 'Admin',
    description: 'TMS administrators — invite therapists and other admins',
  });
  const therapistGroup = new cognito.CfnUserPoolGroup(scope, 'TmsTherapistGroup', {
    userPoolId: userPool.userPoolId,
    groupName: 'Therapist',
  });
  void adminGroup;
  void therapistGroup;

  const spaOrigin = (props.spaOrigin || '').replace(/\/$/, '');
  const webClient = userPool.addClient('TmsWebClient', {
    authFlows: { userPassword: true, userSrp: true },
    preventUserExistenceErrors: true,
    ...(spaOrigin
      ? {
          oAuth: {
            flows: { authorizationCodeGrant: true },
            scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
            callbackUrls: [`${spaOrigin}/`],
            logoutUrls: [`${spaOrigin}/`],
          },
        }
      : {}),
  });

  /**
   * Luna OpenAI key. Initial placeholder is ignored after the secret exists —
   * paste the real key in Secrets Manager (or seed once via -c openaiApiKey=sk-...).
   */
  const lunaOpenAiSecret = new secretsmanager.Secret(scope, 'TmsLunaOpenAiSecret', {
    description: 'OpenAI API key for Luna TMS support chatbot (plain string, not JSON)',
    secretStringValue: cdk.SecretValue.unsafePlainText(
      (props.openaiApiKey || '').trim() || 'REPLACE_ME_IN_SECRETS_MANAGER',
    ),
  });

  /**
   * DocuSign REST creds for principal e-sign after therapist "Send timesheet".
   * JSON: { "baseUrl", "accessToken", "accountId", "webhookUrl"? }.
   * webhookUrl should be `{TmsApiUrl}/webhooks/esign` (DocuSign Connect completed).
   */
  const docusignSecret = new secretsmanager.Secret(scope, 'TmsDocuSignSecret', {
    description:
      'DocuSign API for TMS timesheet e-sign (JSON: baseUrl, accessToken, accountId, webhookUrl)',
    secretStringValue: cdk.SecretValue.unsafePlainText(
      JSON.stringify({
        baseUrl: 'https://demo.docusign.net/restapi',
        accessToken: 'REPLACE_ME',
        accountId: 'REPLACE_ME',
        webhookUrl: '',
      }),
    ),
  });

  /**
   * Single-table TMS state: one item per entity (sessions, weeks, users, …).
   * Replaces whole-file S3 tms/state.json for concurrency-safe writes.
   * PDFs / locker files remain on the reports bucket under tms/*.
   */
  const stateTable = new dynamodb.Table(scope, 'TmsStateTable', {
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
    encryptionKey: props.encryptionKey,
  });

  const fn = new NodejsFunction(scope, 'TmsApiFn', {
    entry: path.join(repoRoot, 'packages/tms-api/src/handler.ts'),
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_22_X,
    timeout: cdk.Duration.minutes(2),
    memorySize: 1024,
    environment: {
      REPORTS_BUCKET: props.reportsBucket.bucketName,
      TMS_STATE_TABLE: stateTable.tableName,
      HHA_SECRET_ARN: props.hhaSecret.secretArn,
      TMS_BEDROCK_MODEL_ID: props.bedrockModelId || '',
      TMS_FROM_EMAIL: props.fromEmail || '',
      TMS_USER_POOL_ID: userPool.userPoolId,
      TMS_CLIENT_ID: webClient.userPoolClientId,
      TMS_INTERNAL_KEY: props.internalKey || '',
      /** Real SOAP client; sandbox until Moshe says otherwise (do not force production). */
      HHA_USE_MOCK: 'false',
      HHA_PRODUCTION_BASE_URL: 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx',
      HHA_USE_PRODUCTION: 'false',
      HHA_ALLOW_PRODUCTION: 'false',
      OPENAI_SECRET_ARN: lunaOpenAiSecret.secretArn,
      TMS_DOCUSIGN_SECRET_ARN: docusignSecret.secretArn,
      LUNA_SUPPORT_EMAIL: props.lunaSupportEmail || 'moshe@advancedautomations.net',
      OPENAI_MODEL: props.openaiModel || 'gpt-4o-mini',
      /** End-of-day HHA failure digest (SES). Recipient must be verified while SES is in sandbox. */
      TMS_HHA_ERROR_EMAIL: 'mgluck@whiteglovecare.net',
      ...(spaOrigin
        ? { TMS_CORS_ORIGIN: spaOrigin, TMS_SPA_ORIGIN: spaOrigin }
        : { TMS_SPA_ORIGIN: 'https://wgfront.netlify.app' }),
    },
    bundling: {
      minify: true,
      sourceMap: true,
      format: OutputFormat.ESM,
      banner:
        "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      mainFields: ['module', 'main'],
      externalModules: ['playwright', 'playwright-core', '@playwright/test'],
    },
    depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
    projectRoot: repoRoot,
  });
  props.reportsBucket.grantReadWrite(fn, 'tms/*');
  stateTable.grantReadWriteData(fn);
  props.hhaSecret.grantRead(fn);
  lunaOpenAiSecret.grantRead(fn);
  docusignSecret.grantRead(fn);
  userPool.grant(
    fn,
    'cognito-idp:AdminCreateUser',
    'cognito-idp:AdminAddUserToGroup',
    'cognito-idp:AdminRemoveUserFromGroup',
    'cognito-idp:AdminDisableUser',
    'cognito-idp:AdminDeleteUser',
  );
  fn.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }),
  );

  new events.Rule(scope, 'TmsDueNagRule', {
    schedule: events.Schedule.cron({ minute: '0', hour: '12' }),
    description: 'Daily TMS due-date nags (progress / annual / reeval) until complete',
    targets: [new targets.LambdaFunction(fn, { event: events.RuleTargetInput.fromObject({ tmsJob: 'due-nags' }) })],
  });

  // 22:00 UTC ≈ 6:00 PM Eastern (EDT). During EST this is 5:00 PM Eastern.
  new events.Rule(scope, 'TmsHhaErrorDigestRule', {
    schedule: events.Schedule.cron({ minute: '0', hour: '22' }),
    description:
      'Daily end-of-day HHA transfer failure digest to mgluck@whiteglovecare.net (~6pm Eastern)',
    targets: [
      new targets.LambdaFunction(fn, {
        event: events.RuleTargetInput.fromObject({ tmsJob: 'hha-error-digest' }),
      }),
    ],
  });

  const apiUrl = fn.addFunctionUrl({
    authType: lambda.FunctionUrlAuthType.NONE,
    cors: {
      allowedOrigins: spaOrigin ? [spaOrigin] : ['*'],
      allowedMethods: [lambda.HttpMethod.ALL],
      allowedHeaders: ['content-type', 'authorization', 'x-tms-role', 'x-tms-email'],
    },
  });

  new cdk.CfnOutput(scope, 'TmsApiUrl', {
    value: apiUrl.url,
    description: 'Therapy management API (SPA calls this). Admin creates Cognito users.',
  });
  new cdk.CfnOutput(scope, 'TmsUserPoolId', { value: userPool.userPoolId });
  new cdk.CfnOutput(scope, 'TmsWebClientId', {
    value: webClient.userPoolClientId,
    description: 'Cognito app client id (set as TMS_CLIENT_ID for the SPA build).',
  });
  new cdk.CfnOutput(scope, 'TmsLunaOpenAiSecretArn', {
    value: lunaOpenAiSecret.secretArn,
    description:
      'Paste OpenAI API key as the secret string value (Secrets Manager console). Used by Luna chatbot.',
  });
  new cdk.CfnOutput(scope, 'TmsDocuSignSecretArn', {
    value: docusignSecret.secretArn,
    description:
      'DocuSign JSON secret (baseUrl, accessToken, accountId, webhookUrl={TmsApiUrl}webhooks/esign).',
  });
  new cdk.CfnOutput(scope, 'TmsWebHint', {
    value: spaOrigin
      ? `Host apps/tms-web on ${spaOrigin} (e.g. Netlify). Set TMS_API_URL there to TmsApiUrl.`
      : 'Host apps/tms-web elsewhere (e.g. Netlify). Set TMS_API_URL to TmsApiUrl. Redeploy with -c tmsSpaOrigin=https://your-site.netlify.app for Cognito + CORS.',
  });
  new cdk.CfnOutput(scope, 'TmsStateTableName', {
    value: stateTable.tableName,
    description: 'DynamoDB single-table for TMS entities (sessions, weeks, caseload, …).',
  });

  return { apiUrl, userPool, stateTable };
}
