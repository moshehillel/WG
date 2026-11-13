import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bids portal data plane. Separate CloudFormation stack so a failure here
 * cannot roll back WhiteGloveStack (HHA / TMS). No cross-stack references.
 * Deploy by stack name only. Do not use infra/cdk-deploy.mjs — that wrapper
 * restores the live pipeline Lambdas after every deploy.
 */
export class WhiteGloveBidsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const dataKey = new kms.Key(this, 'DataEncryptionKey', {
      alias: 'alias/white-glove-bids-data',
      description: 'White Glove Bids CMK for cases, bids, SESIS downloads, and the SESIS secret',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const accessLogs = new s3.Bucket(this, 'SesisAccessLogs', {
      bucketName: `whiteglove-bids-sesis-logs-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
    });

    /**
     * Four SESIS workbook prefixes, separate from the live reports bucket:
     * sesis/preschool-available/  sesis/school-age-available/
     * sesis/preschool-awarded/    sesis/school-age-awarded/
     */
    const downloadsBucket = new s3.Bucket(this, 'SesisDownloadsBucket', {
      bucketName: `whiteglove-bids-sesis-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: accessLogs,
      serverAccessLogsPrefix: 'sesis-downloads/',
      lifecycleRules: [
        {
          id: 'expire-old-sesis-versions',
          prefix: 'sesis/',
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const table = (
      constructId: string,
      tableName: string,
      partitionKey: string,
      sortKey?: string,
    ) =>
      new dynamodb.Table(this, constructId, {
        tableName,
        partitionKey: { name: partitionKey, type: dynamodb.AttributeType.STRING },
        ...(sortKey
          ? { sortKey: { name: sortKey, type: dynamodb.AttributeType.STRING } }
          : {}),
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
        encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
        encryptionKey: dataKey,
      });

    const providers = table('ProvidersTable', 'whiteglove-bids-providers', 'id');
    const preferences = table('PreferencesTable', 'whiteglove-bids-preferences', 'providerId');
    const cases = table('CasesTable', 'whiteglove-bids-cases', 'program', 'caseId');
    const bids = table('BidsTable', 'whiteglove-bids-bids', 'caseId');
    const awards = table('AwardsTable', 'whiteglove-bids-awards', 'caseId');
    const unfilled = table('UnfilledTable', 'whiteglove-bids-unfilled', 'id');
    const offers = table('OffersTable', 'whiteglove-bids-offers', 'providerId', 'offerId');
    const districts = table('DistrictsTable', 'whiteglove-bids-districts', 'id');

    /**
     * SecretString is generated once, then replaced out of band from the repo
     * .env. CloudFormation does not store the SESIS password. The public API
     * function is not granted read on this secret.
     */
    /**
     * Same Cognito shape as TMS: no self sign-up, email alias, SES mail,
     * temporary password on invite, and ForgotPassword confirmation codes.
     * The SESIS secret is not granted to this function.
     */
    const cognitoFromEmail = 'alerts@advancedautomations.net';
    const userPool = new cognito.UserPool(this, 'BidsUserPool', {
      userPoolName: 'white-glove-bids',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_AND_PHONE_WITHOUT_MFA,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      email: cognito.UserPoolEmail.withSES({
        fromEmail: cognitoFromEmail,
        fromName: 'White Glove Bids',
        replyTo: cognitoFromEmail,
        sesVerifiedDomain: 'advancedautomations.net',
      }),
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false, email: true },
      signInPolicy: {
        allowedFirstAuthFactors: { password: true, emailOtp: true, passkey: true },
      },
      passkeyRelyingPartyId: 'whiteglovebidding.netlify.app',
      passkeyUserVerification: cognito.PasskeyUserVerification.REQUIRED,
      deviceTracking: {
        challengeRequiredOnNewDevice: true,
        deviceOnlyRememberedOnUserPrompt: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const cfnUserPool = userPool.node.defaultChild as cognito.CfnUserPool;
    cfnUserPool.webAuthnFactorConfiguration = 'MULTI_FACTOR_WITH_USER_VERIFICATION';
    new cognito.CfnUserPoolGroup(this, 'BidsAdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'Admin',
      description: 'Bids administrators — invite therapists',
    });
    new cognito.CfnUserPoolGroup(this, 'BidsTherapistGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'Therapist',
    });
    const webClient = userPool.addClient('BidsWebClient', {
      authFlows: { userPassword: true, userSrp: true, user: true },
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: ['https://whiteglovebidding.netlify.app/'],
        logoutUrls: ['https://whiteglovebidding.netlify.app/'],
      },
    });

    const sesisSecret = new secretsmanager.Secret(this, 'SesisSecret', {
      secretName: 'whiteglove-bids-sesis',
      description:
        'SESIS login for Bids downloads (baseUrl, workspace, username, password). Value is set out of band.',
      encryptionKey: dataKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const bidsApiCode = lambda.Code.fromAsset(path.join(__dirname, '../bids-api'));

    const importer = new lambda.Function(this, 'BidsImportFn', {
      functionName: 'whiteglove-bids-import',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'import-handler.handler',
      code: bidsApiCode,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      description: 'Downloads SESIS available then awarded reports into Bids. Does not place a bid.',
      environment: {
        TABLE_PROVIDERS: providers.tableName,
        TABLE_CASES: cases.tableName,
        TABLE_BIDS: bids.tableName,
        TABLE_AWARDS: awards.tableName,
        TABLE_UNFILLED: unfilled.tableName,
        DOWNLOADS_BUCKET: downloadsBucket.bucketName,
        SESIS_SECRET_NAME: sesisSecret.secretName,
        BIDS_SESIS_PLACE_BID: '0',
      },
    });
    cases.grantReadWriteData(importer);
    providers.grantReadWriteData(importer);
    bids.grantReadData(importer);
    awards.grantReadWriteData(importer);
    unfilled.grantReadWriteData(importer);
    downloadsBucket.grantReadWrite(importer, 'sesis/*');
    sesisSecret.grantRead(importer);

    new events.Rule(this, 'BidsSesisImportMorning', {
      ruleName: 'whiteglove-bids-sesis-import-morning',
      description: 'SESIS available then awarded import into Bids (morning). No place-bid.',
      schedule: events.Schedule.cron({ minute: '15', hour: '11' }),
      targets: [new targets.LambdaFunction(importer, {
        event: events.RuleTargetInput.fromObject({ mode: 'live', only: 'both' }),
      })],
    });
    new events.Rule(this, 'BidsSesisImportAfternoon', {
      ruleName: 'whiteglove-bids-sesis-import-afternoon',
      description: 'SESIS available then awarded import into Bids (afternoon). No place-bid.',
      schedule: events.Schedule.cron({ minute: '15', hour: '16' }),
      targets: [new targets.LambdaFunction(importer, {
        event: events.RuleTargetInput.fromObject({ mode: 'live', only: 'both' }),
      })],
    });

    const api = new lambda.Function(this, 'BidsApiFn', {
      functionName: 'whiteglove-bids-api',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: bidsApiCode,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      description: 'Bids portal API. SES send for queued mail. Place-bid dry-run unless BIDS_SESIS_PLACE_BID=1.',
      environment: {
        TABLE_PROVIDERS: providers.tableName,
        TABLE_PREFERENCES: preferences.tableName,
        TABLE_CASES: cases.tableName,
        TABLE_BIDS: bids.tableName,
        TABLE_AWARDS: awards.tableName,
        TABLE_UNFILLED: unfilled.tableName,
        TABLE_OFFERS: offers.tableName,
        TABLE_DISTRICTS: districts.tableName,
        DOWNLOADS_BUCKET: downloadsBucket.bucketName,
        IMPORT_FUNCTION_NAME: importer.functionName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: webClient.userPoolClientId,
        SESIS_SECRET_NAME: sesisSecret.secretName,
        BIDS_FROM_EMAIL: cognitoFromEmail,
        BIDS_SESIS_PLACE_BID: '0',
      },
    });
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminRemoveUserFromGroup',
          'cognito-idp:AdminGetUser',
        ],
        resources: [userPool.userPoolArn],
      }),
    );
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      }),
    );

    for (const item of [providers, preferences, cases, bids, awards, unfilled, districts]) {
      item.grantReadWriteData(api);
    }
    offers.grantReadData(api);
    offers.grant(api, 'dynamodb:PutItem');
    downloadsBucket.grantReadWrite(api, 'sesis/*');
    importer.grantInvoke(api);
    sesisSecret.grantRead(api);

    const apiUrl = api.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['content-type', 'accept', 'authorization'],
      },
    });

    new cdk.CfnOutput(this, 'BidsApiUrl', { value: apiUrl.url });
    new cdk.CfnOutput(this, 'BidsImportFunctionName', { value: importer.functionName });
    new cdk.CfnOutput(this, 'ProvidersTableName', { value: providers.tableName });
    new cdk.CfnOutput(this, 'PreferencesTableName', { value: preferences.tableName });
    new cdk.CfnOutput(this, 'CasesTableName', { value: cases.tableName });
    new cdk.CfnOutput(this, 'BidsTableName', { value: bids.tableName });
    new cdk.CfnOutput(this, 'AwardsTableName', { value: awards.tableName });
    new cdk.CfnOutput(this, 'UnfilledTableName', { value: unfilled.tableName });
    new cdk.CfnOutput(this, 'OffersTableName', { value: offers.tableName });
    new cdk.CfnOutput(this, 'DistrictsTableName', { value: districts.tableName });
    new cdk.CfnOutput(this, 'SesisDownloadsBucketName', { value: downloadsBucket.bucketName });
    new cdk.CfnOutput(this, 'SesisAccessLogsBucketName', { value: accessLogs.bucketName });
    new cdk.CfnOutput(this, 'SesisSecretName', { value: sesisSecret.secretName });
    new cdk.CfnOutput(this, 'BidsUserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'BidsUserPoolClientId', { value: webClient.userPoolClientId });
  }
}
