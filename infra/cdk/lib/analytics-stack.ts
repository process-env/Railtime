import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import * as path from 'path';

export class AnalyticsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -----------------------------------------------------------------------
    // DynamoDB Tables
    // -----------------------------------------------------------------------

    const metricsTable = new dynamodb.Table(this, 'MetricsTable', {
      tableName: 'railtime-metrics',
      partitionKey: { name: 'routeId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expireAt',
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const eventsTable = new dynamodb.Table(this, 'EventsTable', {
      tableName: 'railtime-events',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expireAt',
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const rollupsTable = new dynamodb.Table(this, 'RollupsTable', {
      tableName: 'railtime-rollups',
      partitionKey: { name: 'routeId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -----------------------------------------------------------------------
    // S3 Bucket
    // -----------------------------------------------------------------------

    const analyticsBucket = new s3.Bucket(this, 'AnalyticsBucket', {
      bucketName: `railtime-analytics-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'raw-lifecycle',
          prefix: 'raw/',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          expiration: cdk.Duration.days(365),
        },
      ],
    });

    // -----------------------------------------------------------------------
    // Lambda: DynamoDB Streams → S3 (NDJSON)
    // -----------------------------------------------------------------------

    const streamToS3Fn = new NodejsFunction(this, 'StreamToS3', {
      functionName: 'railtime-stream-to-s3',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'stream-to-s3', 'index.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.minutes(5),
      environment: {
        S3_BUCKET: analyticsBucket.bucketName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    analyticsBucket.grantPut(streamToS3Fn);

    // Wire DynamoDB Streams to Lambda
    streamToS3Fn.addEventSource(
      new lambdaEventSources.DynamoEventSource(metricsTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 100,
        maxBatchingWindow: cdk.Duration.minutes(5),
      }),
    );

    streamToS3Fn.addEventSource(
      new lambdaEventSources.DynamoEventSource(eventsTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 100,
        maxBatchingWindow: cdk.Duration.minutes(5),
      }),
    );

    // -----------------------------------------------------------------------
    // Glue: Database, Crawler, ETL Job
    // -----------------------------------------------------------------------

    const glueDatabase = new glue.CfnDatabase(this, 'GlueDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: 'railtime_analytics',
        description: 'Railtime analytics data catalog',
      },
    });

    // Upload Glue script to S3
    const glueScriptDeploy = new s3deploy.BucketDeployment(this, 'GlueScriptDeploy', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', 'glue-scripts'))],
      destinationBucket: analyticsBucket,
      destinationKeyPrefix: 'glue-scripts',
    });

    // Glue IAM Role
    const glueRole = new iam.Role(this, 'GlueJobRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });

    analyticsBucket.grantReadWrite(glueRole);
    rollupsTable.grantWriteData(glueRole);

    const glueJob = new glue.CfnJob(this, 'DailyRollupJob', {
      name: 'railtime-daily-rollup',
      role: glueRole.roleArn,
      command: {
        name: 'glueetl',
        pythonVersion: '3',
        scriptLocation: `s3://${analyticsBucket.bucketName}/glue-scripts/daily-rollup.py`,
      },
      glueVersion: '4.0',
      maxCapacity: 2,
      defaultArguments: {
        '--S3_BUCKET': analyticsBucket.bucketName,
        '--METRICS_TABLE': metricsTable.tableName,
        '--ROLLUPS_TABLE': rollupsTable.tableName,
        '--EVENTS_TABLE': eventsTable.tableName,
        '--job-language': 'python',
        '--enable-continuous-cloudwatch-log': 'true',
      },
    });

    // Crawler for raw data
    const crawlerRole = new iam.Role(this, 'CrawlerRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });
    analyticsBucket.grantRead(crawlerRole);

    new glue.CfnCrawler(this, 'RawDataCrawler', {
      name: 'railtime-raw-crawler',
      role: crawlerRole.roleArn,
      databaseName: 'railtime_analytics',
      targets: {
        s3Targets: [
          { path: `s3://${analyticsBucket.bucketName}/raw/metrics/` },
          { path: `s3://${analyticsBucket.bucketName}/raw/events/` },
        ],
      },
      schedule: { scheduleExpression: 'cron(30 0 * * ? *)' },
    });

    // -----------------------------------------------------------------------
    // Lambda: Glue Trigger (EventBridge daily at 01:00 UTC)
    // -----------------------------------------------------------------------

    const glueTriggerFn = new NodejsFunction(this, 'GlueTrigger', {
      functionName: 'railtime-glue-trigger',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'glue-trigger', 'index.ts'),
      handler: 'handler',
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
      environment: {
        GLUE_JOB_NAME: 'railtime-daily-rollup',
      },
      bundling: {
        minify: true,
      },
    });

    glueTriggerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['glue:StartJobRun'],
        resources: [`arn:aws:glue:${this.region}:${this.account}:job/railtime-daily-rollup`],
      }),
    );

    new events.Rule(this, 'DailyGlueTrigger', {
      ruleName: 'railtime-daily-rollup-trigger',
      schedule: events.Schedule.cron({ minute: '0', hour: '1' }),
      targets: [new targets.LambdaFunction(glueTriggerFn)],
    });

    // -----------------------------------------------------------------------
    // AppSync GraphQL API
    // -----------------------------------------------------------------------

    const api = new appsync.GraphqlApi(this, 'AnalyticsApi', {
      name: 'RailtimeAnalyticsAPI',
      definition: appsync.Definition.fromFile(
        path.join(__dirname, '..', 'appsync', 'schema.graphql'),
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: cdk.Expiration.after(cdk.Duration.days(365)),
          },
        },
      },
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ERROR,
      },
    });

    // Data sources
    const metricsDS = api.addDynamoDbDataSource('MetricsDS', metricsTable);
    const rollupsDS = api.addDynamoDbDataSource('RollupsDS', rollupsTable);

    // Resolvers
    metricsDS.createResolver('GetRouteMetrics', {
      typeName: 'Query',
      fieldName: 'getRouteMetrics',
      requestMappingTemplate: appsync.MappingTemplate.fromFile(
        path.join(__dirname, '..', 'appsync', 'resolvers', 'getRouteMetrics.req.vtl'),
      ),
      responseMappingTemplate: appsync.MappingTemplate.fromFile(
        path.join(__dirname, '..', 'appsync', 'resolvers', 'getRouteMetrics.res.vtl'),
      ),
    });

    rollupsDS.createResolver('GetDailyRollups', {
      typeName: 'Query',
      fieldName: 'getDailyRollups',
      requestMappingTemplate: appsync.MappingTemplate.fromFile(
        path.join(__dirname, '..', 'appsync', 'resolvers', 'getDailyRollups.req.vtl'),
      ),
      responseMappingTemplate: appsync.MappingTemplate.fromFile(
        path.join(__dirname, '..', 'appsync', 'resolvers', 'getDailyRollups.res.vtl'),
      ),
    });

    metricsDS.createResolver('GetLatestSystemHealth', {
      typeName: 'Query',
      fieldName: 'getLatestSystemHealth',
      requestMappingTemplate: appsync.MappingTemplate.fromFile(
        path.join(__dirname, '..', 'appsync', 'resolvers', 'getLatestSystemHealth.req.vtl'),
      ),
      responseMappingTemplate: appsync.MappingTemplate.fromFile(
        path.join(__dirname, '..', 'appsync', 'resolvers', 'getLatestSystemHealth.res.vtl'),
      ),
    });

    // Events data source (for trip events)
    const eventsDS = api.addDynamoDbDataSource('EventsDS', eventsTable);

    eventsDS.createResolver('GetTripEvents', {
      typeName: 'Query',
      fieldName: 'getTripEvents',
      requestMappingTemplate: appsync.MappingTemplate.fromFile(
        path.join(__dirname, '..', 'appsync', 'resolvers', 'getTripEvents.req.vtl'),
      ),
      responseMappingTemplate: appsync.MappingTemplate.fromFile(
        path.join(__dirname, '..', 'appsync', 'resolvers', 'getTripEvents.res.vtl'),
      ),
    });

    // None data source for mutations (subscriptions backed by local resolver)
    const noneDS = api.addNoneDataSource('NoneDS');
    noneDS.createResolver('PublishRouteMetric', {
      typeName: 'Mutation',
      fieldName: 'publishRouteMetric',
      requestMappingTemplate: appsync.MappingTemplate.fromString(
        `{ "version": "2017-02-28", "payload": $util.toJson($context.arguments) }`,
      ),
      responseMappingTemplate: appsync.MappingTemplate.fromString(
        `$util.toJson($context.result)`,
      ),
    });

    // -----------------------------------------------------------------------
    // Pipeline Alerting — SNS + CloudWatch Alarms
    // -----------------------------------------------------------------------

    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'railtime-pipeline-alerts',
      displayName: 'Railtime Pipeline Alerts',
    });

    // --- Lambda Alarms ---

    // stream-to-s3: errors > 0 in 5 min
    const streamToS3ErrorsAlarm = streamToS3Fn.metricErrors({
      period: cdk.Duration.minutes(5),
    }).createAlarm(this, 'StreamToS3Errors', {
      alarmName: 'railtime-stream-to-s3-errors',
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'stream-to-s3 Lambda failing — DynamoDB records not reaching S3',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    streamToS3ErrorsAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    // stream-to-s3: duration > 240s (approaching 5-min timeout)
    const streamToS3DurationAlarm = streamToS3Fn.metricDuration({
      period: cdk.Duration.minutes(5),
      statistic: 'Maximum',
    }).createAlarm(this, 'StreamToS3Duration', {
      alarmName: 'railtime-stream-to-s3-duration',
      threshold: 240_000,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'stream-to-s3 approaching timeout — batch size may be too large',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    streamToS3DurationAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    // glue-trigger: errors > 0
    const glueTriggerErrorsAlarm = glueTriggerFn.metricErrors({
      period: cdk.Duration.minutes(5),
    }).createAlarm(this, 'GlueTriggerErrors', {
      alarmName: 'railtime-glue-trigger-errors',
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'glue-trigger failed — daily ETL will not run',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    glueTriggerErrorsAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    // --- DynamoDB Alarms ---

    // WriteThrottleEvents on metrics table
    const metricsThrottleAlarm = new cloudwatch.Alarm(this, 'MetricsWriteThrottles', {
      alarmName: 'railtime-metrics-write-throttles',
      metric: metricsTable.metricThrottledRequestsForOperation('PutItem', {
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'DynamoDB throttling writes — possible hot partition',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    metricsThrottleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    // --- Glue Job Alarm ---

    const glueJobFailureAlarm = new cloudwatch.Alarm(this, 'GlueJobFailure', {
      alarmName: 'railtime-glue-job-failure',
      metric: new cloudwatch.Metric({
        namespace: 'Glue',
        metricName: 'glue.driver.aggregate.numFailedTasks',
        dimensionsMap: { JobName: 'railtime-daily-rollup', Type: 'gauge' },
        period: cdk.Duration.hours(1),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Glue daily-rollup job has failed tasks',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    glueJobFailureAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    // -----------------------------------------------------------------------
    // IAM: WS Server write role (for reference)
    // -----------------------------------------------------------------------

    const wsServerRole = new iam.Role(this, 'WsServerWriteRole', {
      roleName: 'railtime-ws-server-dynamodb',
      assumedBy: new iam.AccountPrincipal(this.account),
    });

    metricsTable.grantWriteData(wsServerRole);
    eventsTable.grantWriteData(wsServerRole);
    rollupsTable.grantWriteData(wsServerRole);

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, 'AppSyncUrl', {
      value: api.graphqlUrl,
      description: 'AppSync GraphQL endpoint URL',
    });

    new cdk.CfnOutput(this, 'AppSyncApiKey', {
      value: api.apiKey ?? '',
      description: 'AppSync API key',
    });

    new cdk.CfnOutput(this, 'MetricsTableName', {
      value: metricsTable.tableName,
    });

    new cdk.CfnOutput(this, 'EventsTableName', {
      value: eventsTable.tableName,
    });

    new cdk.CfnOutput(this, 'RollupsTableName', {
      value: rollupsTable.tableName,
    });

    new cdk.CfnOutput(this, 'AnalyticsBucketName', {
      value: analyticsBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'WsServerRoleArn', {
      value: wsServerRole.roleArn,
      description: 'IAM role ARN for WS server DynamoDB access',
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: alertTopic.topicArn,
      description: 'SNS topic ARN for pipeline alerts (subscribe via: aws sns subscribe --topic-arn <arn> --protocol email --notification-endpoint <email>)',
    });
  }
}
