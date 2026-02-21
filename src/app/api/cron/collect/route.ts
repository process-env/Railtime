import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobName = process.env.GLUE_JOB_NAME;
  if (!jobName) {
    return NextResponse.json(
      { error: 'GLUE_JOB_NAME not configured' },
      { status: 500 },
    );
  }

  try {
    const { GlueClient, StartJobRunCommand } = await import(
      '@aws-sdk/client-glue'
    );
    const glue = new GlueClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
    });
    const result = await glue.send(
      new StartJobRunCommand({ JobName: jobName }),
    );

    return NextResponse.json({
      success: true,
      jobRunId: result.JobRunId,
    });
  } catch (err) {
    console.error('[cron/collect] Failed to start Glue job:', err);
    return NextResponse.json(
      { error: 'Failed to start job' },
      { status: 500 },
    );
  }
}
