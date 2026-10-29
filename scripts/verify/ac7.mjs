
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

const h = await boot({ hidden: ['alpha'], groups: [{ key: 'ga', label: 'A', intro: 'a', members: ['alpha'], enabled: true }] })
await h.disclose('group_ga')
const hiddenAfterDisclose = h.view()
const asm = await h.assemble()
const leaked = hiddenAfterDisclose.includes('alpha') || asm.tools.some(t => t.name === 'alpha')
await h.rpc('set', { name: 'alpha', hidden: false })
const visibleAfterUnhide = h.view().includes('alpha')
report('AC7', !leaked && visibleAfterUnhide, { hiddenAfterDisclose, wireAfterDisclose: asm.tools.map(t => t.name), visibleAfterUnhide })
