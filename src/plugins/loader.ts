/**
 * Plugin Loader — dynamically imports and initialises all enabled plugins.
 *
 * Returns the list of plugin names that were successfully loaded so the
 * caller can surface them in run-summary output.
 */

import { getEnabledPlugins } from './store.js'
import { findPlugin } from './registry.js'
import type { RunnerContext } from '../pluginContext.js'

export async function loadEnabledPlugins(context: RunnerContext): Promise<string[]> {
  const enabled = getEnabledPlugins()
  const loaded: string[] = []

  for (const installed of enabled) {
    const def = findPlugin(installed.name)
    if (!def) {
      if (context.verbose) {
        console.warn(`  [plugins] Unknown plugin "${installed.name}" — skipping`)
      }
      continue
    }

    try {
      const mod = await import(def.modulePath)
      // Support both default export factories and named exports
      const factory: ((ctx: RunnerContext) => { onload: () => void | Promise<void> }) | undefined =
        mod.default ?? mod

      if (typeof factory !== 'function') {
        if (context.verbose) {
          console.warn(`  [plugins] "${installed.name}" did not export a factory function — skipping`)
        }
        continue
      }

      await factory(context).onload()
      loaded.push(installed.name)
    } catch (err: any) {
      if (context.verbose) {
        console.warn(`  [plugins] Failed to load "${installed.name}": ${err?.message ?? String(err)}`)
      }
    }
  }

  return loaded
}
