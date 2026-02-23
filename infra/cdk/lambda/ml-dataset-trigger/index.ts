import { GlueClient, StartJobRunCommand } from '@aws-sdk/client-glue';

const glue = new GlueClient({});
const JOB_NAME = process.env.GLUE_JOB_NAME;
if (!JOB_NAME) throw new Error('Missing required environment variable: GLUE_JOB_NAME');

export async function handler(): Promise<void> {
  try {
    const result = await glue.send(
      new StartJobRunCommand({ JobName: JOB_NAME }),
    );

    console.log(`[ml-dataset-trigger] Started job run: ${result.JobRunId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ml-dataset-trigger] Failed to start job: ${message}`);
    throw new Error(`Failed to start Glue job: ${message}`);
  }
}
