#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AnalyticsStack } from '../lib/analytics-stack';
import { MlLabStack } from '../lib/ml-lab-stack';

const app = new cdk.App();

const analyticsStack = new AnalyticsStack(app, 'RailtimeAnalytics', {
  description: 'Railtime NYC subway tracker - analytics pipeline (DynamoDB, S3, Glue, AppSync)',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});

new MlLabStack(app, 'RailtimeMlLab', {
  description: 'Railtime ML Data Laboratory - SageMaker, Glue ML datasets, historical data catalog',
  analyticsBucket: analyticsStack.analyticsBucket,
  alertTopic: analyticsStack.alertTopic,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});

app.synth();
