/** M7: root-plane mount — group tools registered once, members withheld, disclosure works. */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')
const pluginUrl = 'file:///' + path.join(root, 'src/index.js').replaceAll('\\', '/')
let failures = 0
const assert = (n, v, d) => { if (!v) failures += 1; console.log(n + '=' + JSON.stringify(v) + (d === undefined ? '' : ' ' + d)) }

const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-m7-'))
const stateFile = path.join(dir, 'tool-visibility.json')
await writeFile(stateFile, JSON.stringify({ hidden: [], groups: [{ key: 'ga', label: 'A', intro: 'intro A', members: ['alpha'], enabled: true }] }))
const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await Promise.resolve()
const tools = ctx.get('tools')
const sp = ctx.get('systemPrompt')
const mk = n => defineTool({ name: n, description: n + ' tool', parameters: {}, output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: n }] }, async execute() { return n } })
for (const n of ['alpha', 'gamma']) tools.register(mk(n))
const sc = createScope(tools.ctx, {})
const agent = { id: 'A', ctx: sc.ctx }
class Agents extends Service { constructor(c) { super(c, 'agents') } list() { return [agent] } }
await ctx.plugin(Agents)
// ROOT mount: the plugin row lives at the host plane, not in an agent scope.
const plugin = await import(pluginUrl + '?v=' + Math.random())
await plugin.apply(ctx, { stateFile, __scopeOf: scopeOf })
const view = () => tools.schemas(scopeOf(sc.ctx)).map(s => s.name).sort()
const assemble = () => sp.assemble({ scope: scopeOf(sc.ctx) })

const groupTools = tools.schemas().map(s => s.name).filter(n => n.startsWith('group_'))
assert('root_group_tools_single', groupTools.join(',') === 'group_ga', JSON.stringify(groupTools))
assert('root_member_withheld', !view().includes('alpha'), JSON.stringify(view()))
const before = await assemble()
assert('root_wire_withheld', !before.tools.some(t => t.name === 'alpha'))
const disp = await tools.execute({ signal: new AbortController().signal, callId: 'c1', name: 'group_ga', arguments: {}, agent })
assert('root_disclosure_ok', disp.isError === false)
const after = await assemble()
assert('root_member_after_disclosure', after.tools.some(t => t.name === 'alpha'))
assert('root_ungrouped_visible', after.tools.some(t => t.name === 'gamma'))

if (failures > 0) { console.error('M7 FAIL failures=' + failures); process.exit(1) }
console.log('M7 PASS')
process.exit(0)