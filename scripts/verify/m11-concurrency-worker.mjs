/**
 * M11 worker: one competing host process. Boots the plugin against a shared
 * state file, waits for the go signal, then performs exactly one write.
 *
 * argv: stateFile readyFile goFile mode toolName resultFile usageFile
 *   mode 'groups' -> groups-save (intro A v2, member alpha)
 *   mode 'hide'   -> hide toolName
 */
import { Context } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [stateFile, readyFile, goFile, mode, toolName, resultFile, usageFile] = process.argv.slice(2)
const root = path.resolve(import.meta.dirname, '../..')
const pluginUrl = 'file:///' + path.join(root, 'src/index.js').replaceAll('\\', '/')

async function finish(value, code) {
  await writeFile(resultFile, JSON.stringify(value), 'utf8').catch(() => {})
  process.exit(code)
}

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await Promise.resolve()
const tools = ctx.get('tools')
for (const name of ['alpha', 'beta']) {
  tools.register(defineTool({
    name,
    description: name + ' tool',
    parameters: {},
    output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: name }] },
    async execute() { return name },
  }))
}
let rpc = null
const plugin = await import(pluginUrl + '?v=' + Math.random())
await plugin.apply(ctx, { stateFile, usageFile, __onRpc: (hook) => { rpc = hook } })

// Both workers must have loaded the file before either writes: that is the
// stale-in-memory situation the merge exists for.
await writeFile(readyFile, 'ready', 'utf8')
const deadline = Date.now() + 20000
for (;;) {
  try { await readFile(goFile); break } catch { /* not yet */ }
  if (Date.now() > deadline) await finish({ ok: false, error: 'go signal timeout' }, 2)
  await new Promise((resolve) => setTimeout(resolve, 20))
}

const result = mode === 'groups'
  ? await rpc('groups-save', { groups: [{ key: 'ga', label: 'A', intro: 'intro A v2', members: ['alpha'], enabled: true }] })
  : await rpc('set', { name: toolName, hidden: true })
await finish(result, 0)
