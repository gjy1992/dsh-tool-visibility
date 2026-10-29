
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')
const pluginUrl = 'file:///' + path.join(root, 'src/index.js').replaceAll('\\', '/')
const boot = async (state) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-verify-'))
  const stateFile = path.join(dir, 'tool-visibility.json')
  await writeFile(stateFile, JSON.stringify(state))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await Promise.resolve()
  const tools = ctx.get('tools')
  const sp = ctx.get('systemPrompt')
  const mk = n => defineTool({ name: n, description: n + ' tool description', parameters: {}, output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: n }] }, async execute() { return n } })
  for (const n of ['alpha', 'beta', 'gamma']) tools.register(mk(n))
  const sc = createScope(tools.ctx, {})
  const agent = { id: 'A', ctx: sc.ctx }
  class Agents extends Service { constructor(c) { super(c, 'agents') } list() { return [agent] } }
  await ctx.plugin(Agents)
  let rpc = null
  const plugin = await import(pluginUrl + '?v=' + Math.random())
  await plugin.apply(ctx, { stateFile, __onRpc: h => { rpc = h }, __scopeOf: scopeOf })
  const view = () => tools.schemas(scopeOf(sc.ctx)).map(s => s.name).sort()
  const assemble = () => sp.assemble({ scope: scopeOf(sc.ctx) })
  const disclose = (name) => tools.execute({ signal: new AbortController().signal, callId: 'c-' + Math.random().toString(36).slice(2), name, arguments: {}, agent })
  return { ctx, tools, sp, rpc, view, assemble, disclose, agent }
}
const report = (title, ok, detail) => {
  console.log(JSON.stringify({ title, ok, detail }, null, 2))
  if (!ok) process.exit(1)
  console.log(title + ' PASS')
  process.exit(0)
}

const h = await boot({ hidden: [], groups: [{ key: 'ga', label: 'A', intro: 'a', members: ['alpha'], enabled: true }] })
const before = h.view()
await h.disclose('group_ga')
const after = h.view()
const ungroupedStable = before.includes('beta') && before.includes('gamma') && after.includes('beta') && after.includes('gamma')
const runCodeRejected = (await h.rpc('groups-save', { groups: [{ key: 'x', label: 'X', intro: '', members: ['run_code'], enabled: true }] })).ok === false
const managerRejected = (await h.rpc('groups-save', { groups: [{ key: 'y', label: 'Y', intro: '', members: ['tool_visibility'], enabled: true }] })).ok === false
const hideManager = await h.rpc('set', { name: 'tool_visibility', hidden: true })
report('AC8', ungroupedStable && runCodeRejected && managerRejected && hideManager.ok === false, { before, after, runCodeRejected, managerRejected, hideManagerRejected: hideManager.ok === false })
