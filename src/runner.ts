import { readFileSync } from 'fs'
import { parseVoidFile } from './parser.js'
import { buildRequest } from './builder.js'
import { executeRest } from './protocols/rest.js'
import { executeWebSocket } from './protocols/websocket.js'
import { executeGrpc } from './protocols/grpc.js'
import { createRunnerContext } from './pluginContext.js'
import { loadEnabledPlugins } from './plugins/loader.js'
import type { RunResult } from './types.js'

export interface RunOptions {
  env?: Record<string, string>
  verbose?: boolean
}

export interface RunFileResult {
  result: RunResult
  /** Plugin names that were active during this run */
  activePlugins: string[]
}

export async function runVoidFile(filePath: string, options: RunOptions = {}): Promise<RunFileResult> {
  const content = readFileSync(filePath, 'utf-8')
  const blocks = parseVoidFile(content)
  const env = options.env ?? {}
  const verbose = options.verbose ?? false

  if (blocks.length === 0) {
    return {
      result: { protocol: 'unknown', url: '', success: false, durationMs: 0, error: `No void blocks found in ${filePath}` },
      activePlugins: [],
    }
  }

  const request = buildRequest(blocks)
  if (!request) {
    return {
      result: { protocol: 'unknown', url: '', success: false, durationMs: 0, error: `Could not build a request from ${filePath}` },
      activePlugins: [],
    }
  }

  // ── Set up plugin context and load all enabled plugins ────────────────────
  const { context, requestHandlers, responseHandlers } = createRunnerContext(env, verbose)
  const activePlugins = await loadEnabledPlugins(context)

  // ── Run request handlers (pre-request phase) ──────────────────────────────
  let builtRequest: any = request
  for (const handler of requestHandlers) {
    try {
      const modified = await handler(builtRequest, blocks)
      if (modified) builtRequest = modified
    } catch (err: any) {
      return {
        result: {
          protocol: (request as any).protocol,
          url: (request as any).url ?? '',
          success: false,
          durationMs: 0,
          error: err?.message || String(err),
        },
        activePlugins,
      }
    }
  }

  // ── Execute request by protocol ───────────────────────────────────────────
  let result: RunResult

  switch (builtRequest.protocol) {
    case 'rest':
      result = await executeRest(builtRequest, env)
      break
    case 'ws':
    case 'wss':
      result = await executeWebSocket(builtRequest, env)
      break
    case 'grpc':
    case 'grpcs':
      result = await executeGrpc(builtRequest, env)
      break
    default:
      return {
        result: {
          protocol: builtRequest.protocol,
          url: builtRequest.url ?? '',
          success: false,
          durationMs: 0,
          error: `Unsupported protocol: ${builtRequest.protocol}`,
        },
        activePlugins,
      }
  }

  // ── Run response handlers (post-response phase) ───────────────────────────
  for (const handler of responseHandlers) {
    try {
      await handler(result, blocks, builtRequest)
    } catch (err: any) {
      if (verbose) console.error(`  [runner] Response handler error: ${err?.message || String(err)}`)
    }
  }

  return { result, activePlugins }
}
