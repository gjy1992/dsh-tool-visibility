/** AC1: with no groups the plugin is byte-equivalent to 0.4.0 behaviour. */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const client = await readFile(path.join(root, 'src/client.js'), 'utf8')
const fixture = JSON.parse(await readFile(path.join(root, 'tests/fixtures/baseline-0.4.0.json'), 'utf8'))
const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-ac1-'))
const stateFile = path.join(dir, 'tool-visibility.json')
const problems = []

const boot = async (groups) => {
  await writeFile(stateFile, JSON.stringify({ hidden: [], ...(groups ? { groups } : {}) }))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await Promise.resolve()
  const tools = ctx.get('tools')
  const mk = n => defineTool({ name: n, description: n, parameters: {}, output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: n }] }, async execute() { return n } })
  for (const n of ['alpha', 'beta']) tools.register(mk(n))
  const sc = createScope(tools.ctx, {})
  class Agents extends Service { constructor(c) { super(c, 'agents') } list() { return [{ ctx: sc.ctx }] } }
  await ctx.plugin(Agents)
  const plugin = await import('file://' + path.join(root, 'src/index.js').replaceAll('\\', '/') + '?v=' + Math.random())
  await plugin.apply(ctx, { stateFile, __scopeOf: scopeOf })
  return tools.schemas(scopeOf(sc.ctx)).map(s => s.name).sort()
}

const none = await boot(null)
const expected = ['alpha', 'beta', 'tool_visibility']
if (JSON.stringify(none) !== JSON.stringify(expected)) problems.push('no-groups view mismatch: ' + JSON.stringify(none))
if (none.some(n => n.startsWith('group_'))) problems.push('group_* leaked without groups')

const withGroup = await boot([{ key: 'ga', label: 'A', intro: 'a', members: ['alpha'], enabled: true }])
if (!withGroup.includes('group_ga')) problems.push('group_ga missing when configured (check is not discriminating)')

for (const token of ['tvi-search', '刷新', '全部恢复', 'tvi-row']) {
  if (!client.includes(token)) problems.push('settings page lost: ' + token)
}
if (fixture.version !== '0.4.0') problems.push('baseline fixture version mismatch')
// Plugin-managed names (harness tools removed) must equal the 0.4.0 fixture.
const pluginManaged = none.filter(n => !['alpha', 'beta'].includes(n)).sort()
// run_code is the runtime-injected PTC transport, absent in a native-mode scope by
// design; the plugin never registers it itself.
const fixtureManaged = fixture.registeredTools.filter(n => n !== 'run_code').sort()
if (JSON.stringify(pluginManaged) !== JSON.stringify(fixtureManaged)) {
  problems.push('plugin-managed set differs from fixture: ' + JSON.stringify({ pluginManaged, fixtureManaged }))
}

if (problems.length > 0) {
  console.log(JSON.stringify({ problems }, null, 2))
  process.exit(1)
}
console.log('AC1 PASS' )
console.log(JSON.stringify({ noGroupsView: none, withGroupView: withGroup, uiTokens: ['tvi-search', '刷新', '全部恢复', 'tvi-row'], baselineVersion: fixture.version }))
process.exit(0)