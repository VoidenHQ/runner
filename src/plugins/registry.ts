/**
 * Plugin Registry — catalog of all plugins available from @voiden/core-extensions.
 *
 * Each entry maps a stable plugin name to its module path within the package.
 * Add new entries here as additional plugins are published.
 */

export interface PluginDefinition {
  /** Stable identifier used in CLI commands and the plugin store */
  name: string
  /** Human-readable description */
  description: string
  /** Import path resolvable from node_modules */
  modulePath: string
}

export const CORE_PLUGINS: PluginDefinition[] = [
  {
    name: 'voiden-scripting',
    description: 'Pre-request and post-response script execution for .void files',
    modulePath: '@voiden/core-extensions/voiden-scripting/runner',
  },
]

export function findPlugin(name: string): PluginDefinition | undefined {
  return CORE_PLUGINS.find(p => p.name === name)
}

export function listPluginNames(): string[] {
  return CORE_PLUGINS.map(p => p.name)
}
