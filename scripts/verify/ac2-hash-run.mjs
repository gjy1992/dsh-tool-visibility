import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
delete process.env.DSH_HOME
const stateFile = path.join(os.homedir(), '.dsh', 'tool-visibility.json')
const sha = b => createHash('sha256').update(b).digest('hex')
const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await Promise.resolve()
const tools = ctx.get('tools')
const mk = n => defineTool({ name: n, description: n, parameters: {}, output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: n }] }, async execute() { return n } })
tools.register(mk('working_directory'))
tools.register(mk('read_file'))
const sc = createScope(tools.ctx, {})
class A extends Service { constructor(c) { super(c, 'agents') } list() { return [{ ctx: sc.ctx }] } }
await ctx.plugin(A)
let rpc = null
const plugin = await import('file:///F:/gitProject/dsh-plugins/dsh-tool-visibility/src/index.js?v=' + Math.random())
await plugin.apply(ctx, { __onRpc: h => { rpc = h }, __scopeOf: scopeOf })
const runId = 'RUN-' + new Date().toISOString().replace(/[:.]/g, '-')
const h0 = sha(await readFile(stateFile))
await rpc('groups-save', { groups: [{ key: 'workspace', label: '工作区工具（证据轮）', intro: '读写工作区文件', members: ['working_directory', 'read_file'], enabled: true }] })
const h1 = sha(await readFile(stateFile))
await rpc('groups-save', { groups: [{ key: 'workspace', label: '工作区工具', intro: '读写工作区文件', members: ['working_directory', 'read_file'], enabled: true }] })
const h2 = sha(await readFile(stateFile))
const parsed = JSON.parse((await readFile(stateFile)).toString('utf8'))
console.log(JSON.stringify({ runId, stateFile, shaBefore: h0, shaAfterFirstSave: h1, shaAfterRestore: h2, changed: h0 !== h1, restored: h2 === h0, groups: parsed.groups }, null, 2))
process.exit(0)