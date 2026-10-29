import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
const home = await mkdtemp(path.join(os.tmpdir(), 'tv-judged-'))
process.env.DSH_HOME = home
const stateFile = path.join(home, 'tool-visibility.json')
await writeFile(stateFile, JSON.stringify({ hidden: [], groups: [{ key: 'docs', label: 'Docs', intro: 'doc intro', members: ['alpha'], enabled: true }] }))
const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await Promise.resolve()
const tools = ctx.get('tools')
const mk = n => defineTool({ name: n, description: n + ' desc', parameters: {}, output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: n }] }, async execute() { return n } })
for (const n of ['alpha', 'gamma']) tools.register(mk(n))
const sc = createScope(tools.ctx, {})
class A extends Service { constructor(c) { super(c, 'agents') } list() { return [{ ctx: sc.ctx }] } }
await ctx.plugin(A)
let rpc = null
const plugin = await import('file:///F:/gitProject/dsh-plugins/dsh-tool-visibility/src/index.js?v=' + Math.random())
await plugin.apply(ctx, { __onRpc: h => { rpc = h }, __scopeOf: scopeOf })
const sha = b => createHash('sha256').update(b).digest('hex')
const before = sha(await readFile(stateFile))
const view = tools.schemas(scopeOf(sc.ctx)).map(s => s.name).sort()
const g = tools.schemas().filter(s => s.name.startsWith('group_')).map(s => ({ name: s.name, description: s.description }))
const r1 = await rpc('groups-save', { groups: [{ key: 'x', label: 'X', intro: '', members: ['run_code'], enabled: true }] })
const r2 = await rpc('groups-save', { groups: [{ key: 'y', label: 'Y', intro: '', members: ['tool_visibility'], enabled: true }] })
const after = sha(await readFile(stateFile))
console.log(JSON.stringify({ agentView: view, groupTools: g, ungroupedVisible: view.includes('gamma'), runCodeRejected: r1.ok === false, toolVisibilityRejected: r2.ok === false, stateShaUnchanged: before === after }, null, 2))
process.exit(0)