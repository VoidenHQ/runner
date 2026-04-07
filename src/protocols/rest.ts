import type { RestRequest, RunResult } from '../types.js'

export async function executeRest(req: RestRequest, env: Record<string, string> = {}): Promise<RunResult> {
  const start = Date.now()

  try {
    // Build URL with query params
    let url = replaceEnvVars(req.url, env)
    const enabledParams = req.queryParams.filter(p => p.enabled && p.key)
    if (enabledParams.length > 0) {
      const qs = enabledParams
        .map(p => `${encodeURIComponent(replaceEnvVars(p.key, env))}=${encodeURIComponent(replaceEnvVars(p.value, env))}`)
        .join('&')
      url += url.includes('?') ? `&${qs}` : `?${qs}`
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`
    }

    // Build headers
    const headers: Record<string, string> = {}
    for (const h of req.headers.filter(h => h.enabled && h.key)) {
      headers[replaceEnvVars(h.key, env)] = replaceEnvVars(h.value, env)
    }

    if (req.contentType && !headers['Content-Type']) {
      headers['Content-Type'] = req.contentType
    }

    // Build fetch options
    const options: RequestInit = { method: req.method, headers }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      options.body = replaceEnvVars(req.body, env)
    }

    const res = await fetch(url, options)
    const durationMs = Date.now() - start

    // Measure body size
    const bodyText = await res.text()
    const size = new TextEncoder().encode(bodyText).length

    return {
      protocol: 'rest',
      method: req.method,
      url,
      success: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: res.statusText,
      durationMs,
      size,
      body: bodyText,
    }
  } catch (err: any) {
    return {
      protocol: 'rest',
      method: req.method,
      url: req.url,
      success: false,
      durationMs: Date.now() - start,
      error: err?.message || String(err),
    }
  }
}

function replaceEnvVars(text: string, env: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => env[key.trim()] ?? match)
}
