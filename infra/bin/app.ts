#!/usr/bin/env node
import 'source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';
import { WhiteGloveStack } from '../lib/white-glove-stack.js';

const app = new cdk.App();

new WhiteGloveStack(app, 'WhiteGloveStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
  },
  description: 'ProviderSoft → HHA automation (Lambda + Step Functions)',
});

app.synth();
