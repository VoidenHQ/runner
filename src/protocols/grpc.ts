import * as grpc from '@grpc/grpc-js'
import type { GrpcRequest, RunResult } from '../types.js'

const CONNECT_TIMEOUT_MS = 10_000

/**
 * Check gRPC connectivity.
 * Does not make a real RPC call — just verifies the channel can reach READY state.
 * For grpcs (TLS), uses the system root certificates.
 * For grpc (plaintext), uses insecure credentials.
 */
export function executeGrpc(req: GrpcRequest, _env: Record<string, string> = {}): Promise<RunResult> {
  const start = Date.now()

  // Strip scheme — grpc-js expects plain host:port
  const host = req.url.replace(/^grpcs?:\/\//, '')

  return new Promise(resolve => {
    const credentials = req.protocol === 'grpcs'
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure()

    let channel: grpc.Channel
    try {
      channel = new grpc.Channel(host, credentials, {
        'grpc.enable_retries': 0,
        'grpc.initial_reconnect_backoff_ms': 100,
        'grpc.max_reconnect_backoff_ms': 500,
      })
    } catch (err: any) {
      resolve({
        protocol: req.protocol,
        url: req.url,
        success: false,
        durationMs: Date.now() - start,
        connected: false,
        error: err?.message || String(err),
      })
      return
    }

    // Kick off a connection attempt
    channel.getConnectivityState(true)

    let settled = false
    const done = (result: RunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { channel.close() } catch {}
      resolve(result)
    }

    const deadline = new Date(Date.now() + CONNECT_TIMEOUT_MS)

    const checkState = () => {
      const state = channel.getConnectivityState(false)

      if (state === grpc.connectivityState.READY) {
        done({
          protocol: req.protocol,
          url: req.url,
          success: true,
          durationMs: Date.now() - start,
          connected: true,
        })
        return
      }

      if (state === grpc.connectivityState.TRANSIENT_FAILURE || state === grpc.connectivityState.SHUTDOWN) {
        done({
          protocol: req.protocol,
          url: req.url,
          success: false,
          durationMs: Date.now() - start,
          connected: false,
          error: `Channel in ${grpc.connectivityState[state]} state`,
        })
        return
      }

      // IDLE or CONNECTING — wait for next state change
      channel.watchConnectivityState(state, deadline, (err) => {
        if (err) {
          // Deadline exceeded
          done({
            protocol: req.protocol,
            url: req.url,
            success: false,
            durationMs: Date.now() - start,
            connected: false,
            error: `Connection timed out after ${CONNECT_TIMEOUT_MS}ms`,
          })
        } else {
          checkState()
        }
      })
    }

    const timer = setTimeout(() => {
      done({
        protocol: req.protocol,
        url: req.url,
        success: false,
        durationMs: Date.now() - start,
        connected: false,
        error: `Connection timed out after ${CONNECT_TIMEOUT_MS}ms`,
      })
    }, CONNECT_TIMEOUT_MS + 500) // safety net

    checkState()
  })
}
