#!/usr/bin/env node
import { program } from 'commander'
import { readFileSync, existsSync, statSync } from 'fs'
import { resolve, basename } from 'path'
import { readdir } from 'fs/promises'
import chalk from 'chalk'
import { runVoidFile } from './runner.js'
import { CORE_PLUGINS, findPlugin } from './plugins/registry.js'
import {
  installPlugin,
  uninstallPlugin,
  setPluginEnabled,
  getAllInstalledPlugins,
  readStore,
} from './plugins/store.js'
import type { RunResult } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadEnvFile(envPath: string): Record<string, string> {
  const env: Record<string, string> = {}
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    env[key] = val
  }
  return env
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** Recursively collect all .void files under a directory. */
async function collectVoidFiles(inputPath: string): Promise<string[]> {
  const abs = resolve(inputPath)
  if (!existsSync(abs)) return []

  const stat = statSync(abs)
  if (stat.isFile()) {
    return abs.endsWith('.void') ? [abs] : []
  }

  if (stat.isDirectory()) {
    const entries = await readdir(abs, { withFileTypes: true })
    const results: string[] = []
    for (const entry of entries) {
      const full = resolve(abs, entry.name)
      if (entry.isDirectory()) {
        results.push(...(await collectVoidFiles(full)))
      } else if (entry.isFile() && entry.name.endsWith('.void')) {
        results.push(full)
      }
    }
    return results
  }

  return []
}

/** Expand a list of paths/globs into resolved .void file paths. */
async function resolveFiles(patterns: string[]): Promise<string[]> {
  const resolved: string[] = []
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      const dir = resolve(pattern.replace(/\/?\*.*$/, '') || '.')
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.void')) {
          resolved.push(resolve(dir, entry.name))
        }
      }
    } else {
      resolved.push(...(await collectVoidFiles(pattern)))
    }
  }
  return resolved
}

// ─────────────────────────────────────────────────────────────────────────────
// Run output formatters
// ─────────────────────────────────────────────────────────────────────────────

const DIVIDER = chalk.gray('─'.repeat(64))

function printRunHeader(fileCount: number, pluginCount: number): void {
  console.log()
  console.log(
    chalk.bold.white('  voiden-runner') +
    chalk.gray(` · ${fileCount} file${fileCount !== 1 ? 's' : ''}`) +
    chalk.gray(` · ${pluginCount} plugin${pluginCount !== 1 ? 's' : ''} active`)
  )
  console.log(DIVIDER)
}

function printRequestResult(
  result: RunResult,
  filePath: string,
  index: number,
  total: number,
  showBody: boolean,
  verbose: boolean,
): void {
  const icon = result.success ? chalk.green('  ✓') : chalk.red('  ✗')
  const counter = chalk.gray(`[${index}/${total}]`)
  const fileName = chalk.bold(basename(filePath))

  console.log()
  console.log(`${counter} ${fileName}`)

  const proto = chalk.cyan(result.protocol.toUpperCase().padEnd(4))
  const method = result.method ? chalk.bold(result.method.padEnd(6)) + ' ' : '       '
  const url = chalk.underline(result.url || '—')
  const time = chalk.gray(formatDuration(result.durationMs))

  let statusPart = ''
  if (result.status !== undefined) {
    const statusColor = result.success ? chalk.green : chalk.red
    statusPart = statusColor(`  ${result.status} ${result.statusText ?? ''}`)
  } else if (result.connected !== undefined) {
    statusPart = result.connected
      ? chalk.green('  Connected')
      : chalk.red('  Failed to connect')
  }

  let sizePart = ''
  if (result.size !== undefined) {
    sizePart = chalk.gray(`  ${formatBytes(result.size)}`)
  }

  console.log(`${icon}  ${proto} ${method}${url}${statusPart}  ${time}${sizePart}`)

  if (!result.success && result.error) {
    console.log(chalk.red(`       ${result.error}`))
  }

  if (result.assertionsPassed !== undefined || result.assertionsFailed !== undefined) {
    const p = result.assertionsPassed ?? 0
    const f = result.assertionsFailed ?? 0
    const assertLine = `       assertions: ${chalk.green(`${p} passed`)}${f > 0 ? chalk.red(` · ${f} failed`) : ''}`
    console.log(assertLine)
    if (result.assertions) {
      for (const a of result.assertions) {
        const aIcon = a.passed ? chalk.green('  ✓') : chalk.red('  ✗')
        console.log(`       ${aIcon}  ${a.message || a.condition || ''}`)
      }
    }
  }

  if (showBody && result.body) {
    const preview = result.body.length > 800
      ? result.body.slice(0, 800) + chalk.gray(' … (truncated)')
      : result.body
    console.log(chalk.gray('       ↳ body:'))
    for (const line of preview.split('\n').slice(0, 20)) {
      console.log(chalk.gray(`         ${line}`))
    }
  }
}

function printRunSummary(
  results: Array<{ file: string; result: RunResult }>,
  totalMs: number,
): void {
  const passed = results.filter(r => r.result.success).length
  const failed = results.length - passed

  console.log()
  console.log(DIVIDER)

  const passedStr = passed > 0 ? chalk.green(`${passed} passed`) : chalk.gray('0 passed')
  const failedStr = failed > 0 ? chalk.red(`${failed} failed`) : chalk.gray('0 failed')

  console.log(
    `  ${chalk.bold('Summary')}  ` +
    `${results.length} request${results.length !== 1 ? 's' : ''}  ·  ` +
    `${passedStr}  ·  ${failedStr}  ·  ` +
    chalk.gray(formatDuration(totalMs) + ' total')
  )
  console.log(DIVIDER)
  console.log()
}

function printRunSummaryJson(
  results: Array<{ file: string; result: RunResult }>,
  totalMs: number,
  activePlugins: string[],
): void {
  const passed = results.filter(r => r.result.success).length
  const output = {
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      totalDurationMs: totalMs,
      activePlugins,
    },
    requests: results.map(r => ({ file: r.file, ...r.result })),
  }
  console.log(JSON.stringify(output, null, 2))
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

program
  .name('voiden-runner')
  .description('Run .void files headlessly — REST, WebSocket, and gRPC')
  .version('0.1.0')

// ── voiden-runner run ─────────────────────────────────────────────────────────

program
  .command('run <paths...>')
  .description(
    'Run .void files — accepts files, directories (recursive), or glob patterns\n\n' +
    '  Examples:\n' +
    '    voiden-runner run auth.void\n' +
    '    voiden-runner run ./requests/\n' +
    '    voiden-runner run auth.void users.void ./smoke/\n' +
    '    voiden-runner run ./ --env .env.staging --fail-on-error\n'
  )
  .option('-e, --env <path>', 'Path to .env file for variable substitution')
  .option('-f, --format <format>', 'Output format: table or json', 'table')
  .option('--show-body', 'Print response body for each request')
  .option('--fail-on-error', 'Exit with code 1 if any request fails (CI mode)')
  .option('--verbose', 'Print plugin and script logs')
  .action(async (paths: string[], opts) => {
    const env: Record<string, string> = {}

    if (opts.env) {
      const envPath = resolve(opts.env)
      if (!existsSync(envPath)) {
        console.error(chalk.red(`Env file not found: ${envPath}`))
        process.exit(1)
      }
      Object.assign(env, loadEnvFile(envPath))
    }

    const resolvedFiles = await resolveFiles(paths)

    if (resolvedFiles.length === 0) {
      console.error(chalk.red('No .void files found at the given path(s)'))
      process.exit(1)
    }

    const isJson = opts.format === 'json'
    const runStart = Date.now()
    let anyFailed = false
    let activePluginsSnapshot: string[] = []
    const allResults: Array<{ file: string; result: RunResult }> = []

    if (!isJson) {
      // We don't know plugin count yet; print after first run (all files share the same set)
      // Defer header until after first file resolves — print it before the loop instead
    }

    // Collect results
    for (let i = 0; i < resolvedFiles.length; i++) {
      const file = resolvedFiles[i]

      try {
        const { result, activePlugins } = await runVoidFile(file, { env, verbose: opts.verbose })
        activePluginsSnapshot = activePlugins // same set for every file
        if (!result.success) anyFailed = true
        allResults.push({ file, result })
      } catch (err: any) {
        anyFailed = true
        allResults.push({
          file,
          result: {
            protocol: 'unknown',
            url: '',
            success: false,
            durationMs: 0,
            error: err?.message || String(err),
          },
        })
      }
    }

    const totalMs = Date.now() - runStart

    if (isJson) {
      printRunSummaryJson(allResults, totalMs, activePluginsSnapshot)
    } else {
      printRunHeader(resolvedFiles.length, activePluginsSnapshot.length)
      for (let i = 0; i < allResults.length; i++) {
        const { file, result } = allResults[i]
        printRequestResult(result, file, i + 1, allResults.length, opts.showBody ?? false, opts.verbose ?? false)
      }
      printRunSummary(allResults, totalMs)
    }

    if (opts.failOnError && anyFailed) {
      process.exit(1)
    }
  })

// ── voiden-runner plugin ──────────────────────────────────────────────────────

const pluginCmd = program
  .command('plugin')
  .description('Manage plugins for .void file execution')

// voiden-runner plugin install [names...] --all
pluginCmd
  .command('install [names...]')
  .description(
    'Install one or more plugins, or all available plugins\n\n' +
    '  Examples:\n' +
    '    voiden-runner plugin install --all\n' +
    '    voiden-runner plugin install voiden-scripting\n'
  )
  .option('--all', 'Install every available plugin from @voiden/core-extensions')
  .action((names: string[], opts) => {
    const targets: string[] = opts.all
      ? CORE_PLUGINS.map(p => p.name)
      : names

    if (targets.length === 0) {
      console.error(chalk.red('Specify plugin name(s) or use --all'))
      console.log(chalk.gray('  Available: ' + CORE_PLUGINS.map(p => p.name).join(', ')))
      process.exit(1)
    }

    let installedCount = 0
    for (const name of targets) {
      const def = findPlugin(name)
      if (!def) {
        console.log(chalk.yellow(`  ⚠  Unknown plugin "${name}" — skipped`))
        continue
      }
      const fresh = installPlugin(name)
      if (fresh) {
        console.log(chalk.green(`  ✓  Installed`) + chalk.bold(` ${name}`) + chalk.gray(`  —  ${def.description}`))
        installedCount++
      } else {
        console.log(chalk.gray(`  ·  Already installed`) + ` ${name}`)
      }
    }

    if (installedCount > 0) {
      console.log()
      console.log(chalk.gray(`  ${installedCount} plugin(s) installed. State saved to ~/.voiden/plugins.json`))
    }
  })

// voiden-runner plugin uninstall <name>
pluginCmd
  .command('uninstall <name>')
  .description('Remove an installed plugin\n\n  Example:\n    voiden-runner plugin uninstall voiden-scripting\n')
  .action((name: string) => {
    const removed = uninstallPlugin(name)
    if (removed) {
      console.log(chalk.green(`  ✓  Uninstalled`) + ` ${name}`)
    } else {
      console.log(chalk.yellow(`  ⚠  Plugin "${name}" is not installed`))
    }
  })

// voiden-runner plugin enable <name>
pluginCmd
  .command('enable <name>')
  .description('Enable a previously disabled plugin\n\n  Example:\n    voiden-runner plugin enable voiden-scripting\n')
  .action((name: string) => {
    const ok = setPluginEnabled(name, true)
    if (ok) {
      console.log(chalk.green(`  ✓  Enabled`) + ` ${name}`)
    } else {
      console.log(chalk.yellow(`  ⚠  Plugin "${name}" is not installed — run: voiden-runner plugin install ${name}`))
    }
  })

// voiden-runner plugin disable <name>
pluginCmd
  .command('disable <name>')
  .description(
    'Disable a plugin without uninstalling it\n\n  Example:\n    voiden-runner plugin disable voiden-scripting\n'
  )
  .action((name: string) => {
    const ok = setPluginEnabled(name, false)
    if (ok) {
      console.log(chalk.yellow(`  ·  Disabled`) + ` ${name}`)
    } else {
      console.log(chalk.yellow(`  ⚠  Plugin "${name}" is not installed`))
    }
  })

// voiden-runner plugin list
pluginCmd
  .command('list')
  .description('List all available and installed plugins')
  .action(() => {
    const store = readStore()

    console.log()
    console.log(chalk.bold('  Available plugins') + chalk.gray('  (@voiden/core-extensions)'))
    console.log(DIVIDER)

    for (const def of CORE_PLUGINS) {
      const installed = store.installedPlugins[def.name]
      let statusBadge: string
      if (!installed) {
        statusBadge = chalk.gray('  not installed')
      } else if (installed.enabled) {
        statusBadge = chalk.green('  ✓ enabled')
      } else {
        statusBadge = chalk.yellow('  · disabled')
      }
      console.log(`  ${chalk.bold(def.name.padEnd(24))}${statusBadge}`)
      console.log(chalk.gray(`    ${def.description}`))
    }

    const extras = getAllInstalledPlugins().filter(p => !findPlugin(p.name))
    if (extras.length > 0) {
      console.log()
      console.log(chalk.bold('  Installed (external)'))
      console.log(DIVIDER)
      for (const p of extras) {
        const badge = p.enabled ? chalk.green('  ✓ enabled') : chalk.yellow('  · disabled')
        console.log(`  ${chalk.bold(p.name.padEnd(24))}${badge}`)
      }
    }

    console.log()
  })

program.parse()
