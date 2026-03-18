/**
 * Proof-of-concept workflow that echoes a message through a durable step.
 * Used to verify the Vercel Workflow runtime is properly configured.
 * This file will be removed or replaced once real workflows are built in stories 2-5.
 */

async function processMessage(message: string): Promise<string> {
  'use step'
  return `[echo] ${message}`
}

export async function echoWorkflow(message: string): Promise<{ result: string }> {
  'use workflow'

  const result = await processMessage(message)

  return { result }
}
