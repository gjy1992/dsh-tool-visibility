/** AC2#0: write a group through the plugin's DEFAULT state path (no DSH_HOME override). */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { readFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

delete process.env.DSH_HOME
const stateFile = path.join(os.homedir(), '.dsh', 'tool-visibility.json')
await copyFile(stateFile, stateFile + '.bak-m1')
const sha = b => createHash('sha256').update(b).digest('hex')

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await Promise.resolve()
const tools = ctx.get('tools')
const mk = n => defineTool({ name: n, description: n + ' desc', parameters: {}, output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: n }] }, async execute() { return n } })
for (const n of ['working_directory', 'read_file', 'write_file']) tools.register(mk(n))
const sc = createScope(tools.ctx, {})
class A extends Service { constructor(c) { super(c, 'agents') } list() { return [{ ctx: sc.ctx }] } }
await ctx.plugin(A)
let rpc = null
const plugin = await import('file:///F:/gitProject/dsh-plugins/dsh-tool-visibility/src/index.js?v=' + Math.random())
await plugin.apply(ctx, { __onRpc: h => { rpc = h }, __scopeOf: scopeOf })
const before = sha(await readFile(stateFile))
const saved = await rpc('groups-save', { groups: [{ key: 'workspace', label: '工作区工具', intro: '读写工作区文件', members: ['working_directory', 'read_file'], enabled: true }] })
const after = sha(await readFile(stateFile))
const parsed = JSON.parse(await readFile(stateFile, 'utf8'))
const first = parsed.groups?.[0]
const reread = JSON.parse(await readFile(stateFile, 'utf8'))
console.log(JSON.stringify({
  stateFile,
  savedOk: saved.ok === true,
  shaBefore: before,
  shaAfter: after,
  groupsIsArray: Array.isArray(parsed.groups),
  firstGroup: first && { key: first.key, label: first.label, intro: first.intro, members: first.members, enabled: first.enabled },
  hasThreeKeys: !!first && 'label' in first && 'intro' in first && 'members' in first,
  rereadEquals: JSON.stringify(reread.groups) === JSON.stringify(parsed.groups),
}, null, 2))
process.exit(0)