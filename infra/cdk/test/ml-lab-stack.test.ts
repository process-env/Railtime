import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import { MlLabStack } from '../lib/ml-lab-stack';

test('MlLabStack matches snapshot', () => {
  const app = new cdk.App();

  // Create a mock analytics stack with the required bucket and topic
  const mockStack = new cdk.Stack(app, 'MockStack');
  const mockBucket = new s3.Bucket(mockStack, 'MockBucket');
  const mockTopic = new sns.Topic(mockStack, 'MockTopic');

  const stack = new MlLabStack(app, 'TestMlLabStack', {
    analyticsBucket: mockBucket,
    alertTopic: mockTopic,
  });

  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});
