import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sagemaker from 'aws-cdk-lib/aws-sagemaker';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import * as path from 'path';

export interface MlLabStackProps extends cdk.StackProps {
  analyticsBucket: s3.Bucket;
}

const GLUE_DB = 'railtime_analytics';

export class MlLabStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MlLabStackProps) {
    super(scope, id, props);

    // -----------------------------------------------------------------------
    // S3: ML Artifacts Bucket
    // -----------------------------------------------------------------------

    const mlBucket = new s3.Bucket(this, 'MlBucket', {
      bucketName: `railtime-ml-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'models-lifecycle',
          prefix: 'models/',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
        {
          id: 'datasets-lifecycle',
          prefix: 'datasets/',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(60),
            },
          ],
        },
      ],
    });

    // -----------------------------------------------------------------------
    // Glue: Historical Tables (Parquet, in existing railtime_analytics DB)
    // -----------------------------------------------------------------------

    new glue.CfnTable(this, 'HistoricalDailyRidership', {
      catalogId: this.account,
      databaseName: GLUE_DB,
      tableInput: {
        name: 'historical_daily_ridership',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          classification: 'parquet',
          has_encrypted_data: 'false',
        },
        storageDescriptor: {
          location: `s3://${props.analyticsBucket.bucketName}/historical/daily_ridership/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'date', type: 'string' },
            { name: 'subways_total_ridership', type: 'double' },
            { name: 'subways_pct_of_pre_pandemic', type: 'double' },
            { name: 'buses_total_ridership', type: 'double' },
            { name: 'buses_pct_of_pre_pandemic', type: 'double' },
            { name: 'lirr_total_ridership', type: 'double' },
            { name: 'lirr_pct_of_pre_pandemic', type: 'double' },
            { name: 'mnr_total_ridership', type: 'double' },
            { name: 'mnr_pct_of_pre_pandemic', type: 'double' },
            { name: 'access_a_ride_total_trips', type: 'double' },
            { name: 'access_a_ride_pct_of_pre_pandemic', type: 'double' },
            { name: 'bridges_tunnels_total_traffic', type: 'double' },
            { name: 'bridges_tunnels_pct_of_pre_pandemic', type: 'double' },
            { name: 'staten_island_railway_total_ridership', type: 'double' },
            { name: 'staten_island_railway_pct_of_pre_pandemic', type: 'double' },
          ],
        },
      },
    });

    new glue.CfnTable(this, 'HistoricalTerminalOtp', {
      catalogId: this.account,
      databaseName: GLUE_DB,
      tableInput: {
        name: 'historical_terminal_otp',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          classification: 'parquet',
          has_encrypted_data: 'false',
        },
        storageDescriptor: {
          location: `s3://${props.analyticsBucket.bucketName}/historical/terminal_otp/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'month', type: 'string' },
            { name: 'division', type: 'string' },
            { name: 'line', type: 'string' },
            { name: 'on_time_pct', type: 'double' },
          ],
        },
      },
    });

    new glue.CfnTable(this, 'HistoricalMajorIncidents', {
      catalogId: this.account,
      databaseName: GLUE_DB,
      tableInput: {
        name: 'historical_major_incidents',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          classification: 'parquet',
          has_encrypted_data: 'false',
        },
        storageDescriptor: {
          location: `s3://${props.analyticsBucket.bucketName}/historical/major_incidents/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'month', type: 'string' },
            { name: 'category', type: 'string' },
            { name: 'sub_category', type: 'string' },
            { name: 'division', type: 'string' },
            { name: 'line', type: 'string' },
            { name: 'incident_count', type: 'bigint' },
          ],
        },
      },
    });

    new glue.CfnTable(this, 'HistoricalFareEvasion', {
      catalogId: this.account,
      databaseName: GLUE_DB,
      tableInput: {
        name: 'historical_fare_evasion',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          classification: 'parquet',
          has_encrypted_data: 'false',
        },
        storageDescriptor: {
          location: `s3://${props.analyticsBucket.bucketName}/historical/fare_evasion/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'quarter', type: 'string' },
            { name: 'estimated_fare_evasion_pct', type: 'double' },
            { name: 'estimated_fare_evasion_rides', type: 'bigint' },
          ],
        },
      },
    });

    new glue.CfnTable(this, 'HistoricalMdbf', {
      catalogId: this.account,
      databaseName: GLUE_DB,
      tableInput: {
        name: 'historical_mdbf',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          classification: 'parquet',
          has_encrypted_data: 'false',
        },
        storageDescriptor: {
          location: `s3://${props.analyticsBucket.bucketName}/historical/mdbf/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'month', type: 'string' },
            { name: 'car_class', type: 'string' },
            { name: 'division', type: 'string' },
            { name: 'mdbf', type: 'double' },
          ],
        },
      },
    });

    new glue.CfnTable(this, 'HistoricalCustomerJourney', {
      catalogId: this.account,
      databaseName: GLUE_DB,
      tableInput: {
        name: 'historical_customer_journey',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          classification: 'parquet',
          has_encrypted_data: 'false',
        },
        storageDescriptor: {
          location: `s3://${props.analyticsBucket.bucketName}/historical/customer_journey/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'month', type: 'string' },
            { name: 'metric_name', type: 'string' },
            { name: 'metric_value', type: 'double' },
            { name: 'division', type: 'string' },
          ],
        },
      },
    });

    new glue.CfnTable(this, 'HistoricalServiceDelivered', {
      catalogId: this.account,
      databaseName: GLUE_DB,
      tableInput: {
        name: 'historical_service_delivered',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          classification: 'parquet',
          has_encrypted_data: 'false',
        },
        storageDescriptor: {
          location: `s3://${props.analyticsBucket.bucketName}/historical/service_delivered/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'month', type: 'string' },
            { name: 'line', type: 'string' },
            { name: 'weekday_pct', type: 'double' },
            { name: 'weekend_pct', type: 'double' },
            { name: 'total_pct', type: 'double' },
          ],
        },
      },
    });

    // -----------------------------------------------------------------------
    // Glue: Raw Positions Table (Hive-partitioned, gzipped NDJSON)
    // -----------------------------------------------------------------------

    new glue.CfnTable(this, 'RawPositionsTable', {
      catalogId: this.account,
      databaseName: GLUE_DB,
      tableInput: {
        name: 'raw_positions',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          classification: 'json',
          compressionType: 'gzip',
        },
        storageDescriptor: {
          location: `s3://${props.analyticsBucket.bucketName}/raw/positions/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          },
          columns: [
            { name: 'tripId', type: 'string' },
            { name: 'routeId', type: 'string' },
            { name: 'lat', type: 'double' },
            { name: 'lon', type: 'double' },
            { name: 'heading', type: 'double' },
            { name: 'nextStopId', type: 'string' },
            { name: 'nextStopName', type: 'string' },
            { name: 'eta', type: 'string' },
            { name: 'headsign', type: 'string' },
            { name: 'prevStopId', type: 'string' },
            { name: 'prevTimeMs', type: 'bigint' },
            { name: 'nextTimeMs', type: 'bigint' },
            { name: 'feedGroupId', type: 'string' },
            { name: 'capturedAt', type: 'bigint' },
          ],
        },
        partitionKeys: [
          { name: 'year', type: 'string' },
          { name: 'month', type: 'string' },
          { name: 'day', type: 'string' },
          { name: 'hour', type: 'string' },
        ],
      },
    });

    // -----------------------------------------------------------------------
    // SageMaker: Notebook Instance + IAM Role
    // -----------------------------------------------------------------------

    const notebookRole = new iam.Role(this, 'SageMakerRole', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
      ],
    });

    // S3 read on analytics bucket (raw/, historical/)
    props.analyticsBucket.grantRead(notebookRole);

    // S3 read/write on ML bucket
    mlBucket.grantReadWrite(notebookRole);

    // Glue catalog read
    notebookRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'glue:GetDatabase',
          'glue:GetTable',
          'glue:GetTables',
          'glue:GetPartitions',
          'glue:GetPartition',
          'glue:BatchGetPartition',
        ],
        resources: [
          `arn:aws:glue:${this.region}:${this.account}:catalog`,
          `arn:aws:glue:${this.region}:${this.account}:database/${GLUE_DB}`,
          `arn:aws:glue:${this.region}:${this.account}:table/${GLUE_DB}/*`,
        ],
      }),
    );

    // Athena query execution
    notebookRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'athena:StartQueryExecution',
          'athena:GetQueryExecution',
          'athena:GetQueryResults',
          'athena:StopQueryExecution',
        ],
        resources: [
          `arn:aws:athena:${this.region}:${this.account}:workgroup/primary`,
        ],
      }),
    );

    // Athena results bucket access
    mlBucket.grantReadWrite(notebookRole, 'athena-results/*');

    // Lifecycle config: auto-stop after 1 hour idle + package install on create
    const lifecycleConfig =
      new sagemaker.CfnNotebookInstanceLifecycleConfig(
        this,
        'AutoStopConfig',
        {
          notebookInstanceLifecycleConfigName: 'railtime-ml-auto-stop',
          onStart: [
            {
              content: cdk.Fn.base64(
                [
                  '#!/bin/bash',
                  'set -e',
                  '# Auto-stop idle notebook after 1 hour',
                  'IDLE_TIME=3600',
                  'echo "Setting auto-stop to ${IDLE_TIME} seconds"',
                  "cat > /home/ec2-user/autostop.py << 'SCRIPT'",
                  'import json, os, time, urllib.request',
                  'def is_idle(last_activity_threshold):',
                  '    try:',
                  "        response = urllib.request.urlopen('http://localhost:8888/api/sessions')",
                  '        sessions = json.loads(response.read())',
                  '        for s in sessions:',
                  "            kernel = s.get('kernel', {})",
                  "            if kernel.get('execution_state', 'idle') != 'idle':",
                  '                return False',
                  "            last_activity = kernel.get('last_activity', '')",
                  '            if last_activity:',
                  '                from datetime import datetime, timezone',
                  "                last = datetime.fromisoformat(last_activity.replace('Z', '+00:00'))",
                  '                if (datetime.now(timezone.utc) - last).total_seconds() < last_activity_threshold:',
                  '                    return False',
                  '    except: pass',
                  '    return True',
                  'while True:',
                  '    time.sleep(300)',
                  '    if is_idle(${IDLE_TIME}):',
                  "        os.system('sudo shutdown -h now')",
                  'SCRIPT',
                  'nohup python3 /home/ec2-user/autostop.py &',
                ].join('\n'),
              ),
            },
          ],
          onCreate: [
            {
              content: cdk.Fn.base64(
                [
                  '#!/bin/bash',
                  'set -e',
                  '# Run pip install in background — lifecycle config has 5-min timeout',
                  'nohup pip install pyarrow prophet scikit-learn xgboost matplotlib seaborn plotly awswrangler > /home/ec2-user/install.log 2>&1 &',
                ].join('\n'),
              ),
            },
          ],
        },
      );

    new sagemaker.CfnNotebookInstance(this, 'MlNotebook', {
      notebookInstanceName: 'railtime-ml-lab',
      instanceType: 'ml.t3.medium',
      roleArn: notebookRole.roleArn,
      volumeSizeInGb: 20,
      lifecycleConfigName:
        lifecycleConfig.notebookInstanceLifecycleConfigName,
      directInternetAccess: 'Enabled',
    });

    // -----------------------------------------------------------------------
    // Glue: ML Dataset ETL Job
    // -----------------------------------------------------------------------

    const mlGlueRole = new iam.Role(this, 'MlGlueRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSGlueServiceRole',
        ),
      ],
    });

    props.analyticsBucket.grantRead(mlGlueRole);
    mlBucket.grantReadWrite(mlGlueRole);

    new glue.CfnJob(this, 'MlDatasetJob', {
      name: 'railtime-ml-datasets',
      role: mlGlueRole.roleArn,
      command: {
        name: 'glueetl',
        pythonVersion: '3',
        scriptLocation: `s3://${props.analyticsBucket.bucketName}/glue-scripts/ml-dataset-pipeline.py`,
      },
      glueVersion: '4.0',
      maxCapacity: 2,
      defaultArguments: {
        '--ANALYTICS_BUCKET': props.analyticsBucket.bucketName,
        '--ML_BUCKET': mlBucket.bucketName,
        '--job-language': 'python',
        '--enable-continuous-cloudwatch-log': 'true',
      },
    });

    // -----------------------------------------------------------------------
    // EventBridge + Lambda: Daily ML Dataset Trigger (02:00 UTC)
    // -----------------------------------------------------------------------

    const mlTriggerFn = new NodejsFunction(this, 'MlDatasetTrigger', {
      functionName: 'railtime-ml-dataset-trigger',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(
        __dirname,
        '..',
        'lambda',
        'ml-dataset-trigger',
        'index.ts',
      ),
      handler: 'handler',
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
      environment: {
        GLUE_JOB_NAME: 'railtime-ml-datasets',
      },
      bundling: {
        minify: true,
      },
    });

    mlTriggerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['glue:StartJobRun'],
        resources: [
          `arn:aws:glue:${this.region}:${this.account}:job/railtime-ml-datasets`,
        ],
      }),
    );

    new events.Rule(this, 'DailyMlDatasetTrigger', {
      ruleName: 'railtime-ml-dataset-trigger',
      schedule: events.Schedule.cron({ minute: '0', hour: '2' }),
      targets: [new targets.LambdaFunction(mlTriggerFn)],
    });

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, 'MlBucketName', {
      value: mlBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'SageMakerNotebookName', {
      value: 'railtime-ml-lab',
    });

    new cdk.CfnOutput(this, 'SageMakerRoleArn', {
      value: notebookRole.roleArn,
    });
  }
}
