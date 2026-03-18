import { describe, it, expect } from 'vitest'

describe('echo workflow', () => {
  it('processMessage step prefixes the message', async () => {
    // Import the module - outside the workflow compiler, "use step" is a no-op
    // string literal and the function runs as a normal async function.
    //
    // Note: We test the step function directly. The echoWorkflow function
    // itself uses "use workflow" which also becomes a no-op, so calling it
    // directly would just run the function synchronously without durable
    // execution. That's fine for verifying the logic.
    const { echoWorkflow } = await import('@/workflows/echo')
    const result = await echoWorkflow('test message')

    expect(result).toEqual({ result: '[echo] test message' })
  })

  it('processMessage step handles empty string', async () => {
    const { echoWorkflow } = await import('@/workflows/echo')
    const result = await echoWorkflow('')

    expect(result).toEqual({ result: '[echo] ' })
  })
})
