import { NextResponse } from 'next/server'
import { start } from 'workflow/api'
import { echoWorkflow } from '@/workflows/echo'

export async function POST(request: Request) {
  try {
    const body = await request.json() as { message?: string }
    const message = body.message ?? 'hello from workflow'

    // start() is non-blocking - it enqueues the workflow and returns immediately
    const run = await start(echoWorkflow, [message])

    return NextResponse.json({
      status: 'started',
      runId: run.runId,
    })
  } catch (error) {
    console.error('[echo-workflow] Failed to start:', error)
    return NextResponse.json(
      { error: 'Failed to start echo workflow' },
      { status: 500 },
    )
  }
}
