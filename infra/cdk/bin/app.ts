#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AnalyticsStack } from '../lib/analytics-stack';

const app = new cdk.App();

new AnalyticsStack(app, 'RailtimeAnalytics', {
  description: 'Railtime NYC subway tracker - analytics pipeline (DynamoDB, S3, Glue, AppSync)',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});

app.synth();
