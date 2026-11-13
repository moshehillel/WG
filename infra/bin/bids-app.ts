#!/usr/bin/env node
import 'source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';
import { WhiteGloveBidsStack } from '../lib/bids-stack.js';

const app = new cdk.App();

new WhiteGloveBidsStack(app, 'WhiteGloveBidsStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
  },
  description: 'White Glove Bids portal (isolated from the HHA/TMS pipeline)',
});

app.synth();
