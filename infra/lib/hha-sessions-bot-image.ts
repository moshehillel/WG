import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'node:path';

/** ECR + CodeBuild for HHA ENT Sessions Playwright Lambda (SPA token capture). */
export class HhaSessionsBotImage extends Construct {
  readonly repository: ecr.Repository;
  readonly project: codebuild.Project;
  readonly sourceBucket: s3.Bucket;
  readonly bootstrapFn: lambda.Function;

  constructor(scope: Construct, id: string, props: { repoRoot: string }) {
    super(scope, id);

    this.repository = new ecr.Repository(this, 'Repository', {
      repositoryName: 'white-glove/hha-sessions-bot',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      emptyOnDelete: false,
      lifecycleRules: [{ maxImageCount: 5, description: 'Keep last 5 HHA sessions bot images' }],
    });

    this.sourceBucket = new s3.Bucket(this, 'SourceBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ id: 'expire-source-zips', expiration: cdk.Duration.days(14) }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const buildRole = new iam.Role(this, 'CodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    });
    this.repository.grantPullPush(buildRole);
    this.sourceBucket.grantRead(buildRole);
    buildRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/codebuild/*`,
        ],
      }),
    );

    this.project = new codebuild.Project(this, 'BuildProject', {
      projectName: 'white-glove-hha-sessions-bot',
      role: buildRole,
      description: 'Build HHA ENT Sessions Playwright Lambda container',
      source: codebuild.Source.s3({
        bucket: this.sourceBucket,
        path: 'source.zip',
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
        computeType: codebuild.ComputeType.LARGE,
      },
      environmentVariables: {
        ECR_REPO_URI: { value: this.repository.repositoryUri },
        AWS_DEFAULT_REGION: { value: cdk.Stack.of(this).region },
      },
      buildSpec: codebuild.BuildSpec.fromAsset(
        path.join(props.repoRoot, 'infra/codebuild/buildspec-hha-sessions-bot.yml'),
      ),
      timeout: cdk.Duration.minutes(45),
    });

    this.bootstrapFn = new NodejsFunction(this, 'BootstrapBuild', {
      entry: path.join(props.repoRoot, 'infra/lib/bootstrap-bot-build-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        BOT_SOURCE_BUCKET: this.sourceBucket.bucketName,
        BOT_CODEBUILD_PROJECT: this.project.projectName,
        BOT_GITHUB_REPO: 'moshehillel/WG',
        BOT_GITHUB_BRANCH: 'main',
      },
      bundling: {
        minify: true,
        target: 'node22',
        format: OutputFormat.ESM,
        externalModules: ['@aws-sdk/client-s3', '@aws-sdk/client-codebuild'],
      },
      depsLockFilePath: path.join(props.repoRoot, 'package-lock.json'),
      projectRoot: props.repoRoot,
    });
    this.sourceBucket.grantPut(this.bootstrapFn);
    this.bootstrapFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['codebuild:StartBuild'],
        resources: [this.project.projectArn],
      }),
    );
  }
}
