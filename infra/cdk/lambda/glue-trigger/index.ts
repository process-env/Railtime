import { GlueClient, StartJobRunCommand } from '@aws-sdk/client-glue';

const glue = new GlueClient({});
const JOB_NAME = process.env.GLUE_JOB_NAME!;

export async function handler(): Promise<{ statusCode: number; body: string }> {
  try {
    const result = await glue.send(
      new StartJobRunCommand({ JobName: JOB_NAME }),
    );

    console.log(`[glue-trigger] Started job run: ${result.JobRunId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ jobRunId: result.JobRunId }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[glue-trigger] Failed to start job: ${message}`);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: message }),
    };
  }
}
