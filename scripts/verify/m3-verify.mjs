/** M3: hidden double layer, reserved tools, ungrouped visibility (native + PTC), lifecycle. */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')
const pluginUrl = 'file:///' + path.join(root, 'src/index.js').replaceAll('\\', '/')
const checks = {}

const boot = async (state, ptc) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-m3-'))
  const stateFile = path.join(dir, 'tool-visibility.json')
  await writeFile(stateFile, JSON.stringify(state))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  if (ptc) {
    class FakePtc extends Service {
      constructor(c) { super(c, 'ptcRuntime') }
      language = 'typescript'; isolation = 'process'; programFormat = 'function-body'; executionInstructions = ''
      resolve(r) { return r }
      async run() { return { logs: [], value: undefined } }
      async release() {}
    }
    await ctx.plugin(FakePtc)
    await ctx.plugin(ToolRuntime, { mode: 'ptc' })
  } else {
    await ctx.plugin(ToolRuntime)
  }
  await Promise.resolve()
  const tools = ctx.get('tools')
  const sp = ctx.get('systemPrompt')
  const mk = n => defineTool({ name: n, description: n + ' tool', parameters: {}, output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: n }] }, async execute() { return n } })
  for (const n of ['alpha', 'gamma']) tools.register(mk(n))
  const sc = createScope(tools.ctx, {})
  if (ptc) sc.ctx.get('tools').presentAs('both')
  const agent = { id: 'A', ctx: sc.ctx }
  class Agents extends Service { constructor(c) { super(c, 'agents') } list() { return [agent] } }
  await ctx.plugin(Agents)
  let rpc = null
  const plugin = await import(pluginUrl + '?v=' + Math.random())
  await plugin.apply(ctx, { stateFile, __onRpc: h => { rpc = h }, __scopeOf: scopeOf })
  const view = () => tools.schemas(scopeOf(sc.ctx)).map(s => s.name).sort()
  const assemble = () => sp.assemble({ scope: scopeOf(sc.ctx) })
  const disclose = (name) => tools.execute({ signal: new AbortController().signal, callId: 'c-' + Math.random().toString(36).slice(2), name, arguments: {}, agent, parent: 'probe' })
  return { ctx, tools, sp, rpc, view, assemble, disclose, agent }
}

// native: hidden wins, reserved protected, ungrouped visible
const n = await boot({ hidden: ['alpha'], groups: [{ key: 'ga', label: 'A', intro: 'a', members: ['alpha'], enabled: true }] })
await n.disclose('group_ga')
checks['native_hidden_after_disclose'] = !n.view().includes('alpha')
checks['native_ungrouped_visible'] = n.view().includes('gamma')
const hideManager = await n.rpc('set', { name: 'tool_visibility', hidden: true })
checks['hide_manager_rejected'] = hideManager.ok === false
const hideRunCode = await n.rpc('set', { name: 'run_code', hidden: true })
checks['hide_run_code_rejected'] = hideRunCode.ok === false

// PTC: wire keeps run_code, ungrouped bindable, manager callable
const p = await boot({ hidden: ['alpha'], groups: [{ key: 'ga', label: 'A', intro: 'a', members: ['alpha'], enabled: true }] }, true)
await p.disclose('group_ga')
const asm = await p.assemble()
const wire = asm.tools.map(t => t.name).sort()
checks['ptc_wire_has_run_code'] = wire.includes('run_code')
checks['ptc_ungrouped_bindable'] = p.view().includes('gamma')
checks['ptc_manager_callable'] = p.view().includes('tool_visibility')
checks['ptc_hidden_after_disclose'] = !p.view().includes('alpha')

// lifecycle: disposal clears state; re-adding the same agent re-installs the filter
n.ctx.emit('agent/disposed', { agent: n.agent })
const afterDispose = n.view()
await n.assemble()
const afterReinstall = n.view()
checks['dispose_released_state'] = afterDispose.includes('alpha') // restriction released with the agent
checks['reinstall_hides_members'] = !afterReinstall.includes('alpha')

const problems = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k)
console.log(JSON.stringify({ checks, afterDispose, afterReinstall, wire }, null, 2))
if (problems.length > 0) { console.error('FAILED: ' + problems.join(',')); process.exit(1) }
console.log('M3 PASS')
process.exit(0)