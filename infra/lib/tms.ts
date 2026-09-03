import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
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
    fromEmail?: string;
    bedrockModelId?: string;
    spaOrigin?: string;
    internalKey?: string;
  },
): { apiUrl: lambda.FunctionUrl; userPool: cognito.UserPool } {
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

  const fn = new NodejsFunction(scope, 'TmsApiFn', {
    entry: path.join(repoRoot, 'packages/tms-api/src/handler.ts'),
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_22_X,
    timeout: cdk.Duration.minutes(2),
    memorySize: 1024,
    environment: {
      REPORTS_BUCKET: props.reportsBucket.bucketName,
      HHA_SECRET_ARN: props.hhaSecret.secretArn,
      TMS_BEDROCK_MODEL_ID: props.bedrockModelId || '',
      TMS_FROM_EMAIL: props.fromEmail || '',
      TMS_USER_POOL_ID: userPool.userPoolId,
      TMS_CLIENT_ID: webClient.userPoolClientId,
      TMS_INTERNAL_KEY: props.internalKey || '',
      HHA_USE_MOCK: 'false',
      ...(spaOrigin ? { TMS_CORS_ORIGIN: spaOrigin } : {}),
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
  props.hhaSecret.grantRead(fn);
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
  new cdk.CfnOutput(scope, 'TmsWebHint', {
    value: spaOrigin
      ? `Host apps/tms-web on ${spaOrigin} (e.g. Netlify). Set TMS_API_URL there to TmsApiUrl.`
      : 'Host apps/tms-web elsewhere (e.g. Netlify). Set TMS_API_URL to TmsApiUrl. Redeploy with -c tmsSpaOrigin=https://your-site.netlify.app for Cognito + CORS.',
  });

  return { apiUrl, userPool };
}
