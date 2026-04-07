/**
 * RunnerContext — the API given to each runner plugin.
 *
 * TODO: replace local definition with import from '@voiden/sdk/runner'
 *       once the SDK runner entry point is published.
 */

import type { Block } from './types.js'

export type RunnerRequestHandler = (request: any, blocks: Block[]) => any | Promise<any>
export type RunnerResponseHandler = (result: any, blocks: Block[], request: any) => void | Promise<void>

export interface RunnerContext {
  /** Register a handler that builds/modifies the request before it is sent */
  onBuildRequest: (handler: RunnerRequestHandler) => void
  /** Register a handler that processes the result after the request completes */
  onProcessResponse: (handler: RunnerResponseHandler) => void
  /** Env vars loaded from --env file */
  env: Record<string, string>
  /** Whether --verbose flag is set */
  verbose: boolean
}

export interface RunnerPlugin {
  onload: (context: RunnerContext) => void | Promise<void>
  onunload?: () => void
}

export interface BuiltRunnerContext {
  context: RunnerContext
  requestHandlers: RunnerRequestHandler[]
  responseHandlers: RunnerResponseHandler[]
}

export function createRunnerContext(env: Record<string, string>, verbose: boolean): BuiltRunnerContext {
  const requestHandlers: RunnerRequestHandler[] = []
  const responseHandlers: RunnerResponseHandler[] = []

  const context: RunnerContext = {
    onBuildRequest: (handler) => requestHandlers.push(handler),
    onProcessResponse: (handler) => responseHandlers.push(handler),
    env,
    verbose,
  }

  return { context, requestHandlers, responseHandlers }
}
