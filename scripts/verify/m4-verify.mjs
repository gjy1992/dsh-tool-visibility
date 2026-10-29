/** M4: PTC x preset acceptance — main path only, each member declared once per interface. */
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

class FakePtc extends Service {
  constructor(c) { super(c, 'ptcRuntime') }
  language = 'typescript'; isolation = 'process'; programFormat = 'function-body'; executionInstructions = ''
  resolve(r) { return r }
  async run() { return { logs: [], value: undefined } }
  async release() {}
}
const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-m4-'))
const stateFile = path.join(dir, 'tool-visibility.json')
await writeFile(stateFile, JSON.stringify({ hidden: [], groups: [
  { key: 'ga', label: 'A', intro: 'group a', members: ['alpha', 'beta'], enabled: true },
] }))
const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(FakePtc)
await ctx.plugin(ToolRuntime, { mode: 'ptc' })
await Promise.resolve()
const tools = ctx.get('tools')
const sp = ctx.get('systemPrompt')
const mk = n => defineTool({ name: n, description: n + ' tool', parameters: {}, output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: n }] }, async execute() { return n } })
for (const n of ['alpha', 'beta', 'gamma']) tools.register(mk(n))
const sc = createScope(tools.ctx, {})
// preset-plane presentation: this is how an agent preset declares PTC for its agents.
await Promise.resolve()
const agent = { id: 'A', ctx: sc.ctx }
class Agents extends Service { constructor(c) { super(c, 'agents') } list() { return [agent] } }
await ctx.plugin(Agents)
let rpc = null
const plugin = await import(pluginUrl + '?v=' + Math.random())
await plugin.apply(ctx, { stateFile, __onRpc: h => { rpc = h }, __scopeOf: scopeOf })

const assemble = () => sp.assemble({ scope: scopeOf(sc.ctx) })
const before = await assemble()
const sdkBefore = before.sections.find(s => s.name === 'tools:sdk')?.text ?? ''
const disclosing = await tools.execute({ signal: new AbortController().signal, callId: 'c1', name: 'group_ga', arguments: {}, agent, parent: 'ptc' })
const after = await assemble()
const sdkAfter = after.sections.find(s => s.name === 'tools:sdk')?.text ?? ''
const view = tools.schemas(scopeOf(sc.ctx)).map(s => s.name).sort()

checks['wire_before_is_run_code_only'] = JSON.stringify(before.tools.map(t => t.name)) === JSON.stringify(['run_code'])
checks['wire_after_is_run_code_only'] = JSON.stringify(after.tools.map(t => t.name)) === JSON.stringify(['run_code'])
checks['sdk_before_has_no_member'] = !sdkBefore.includes('alpha') && !sdkBefore.includes('beta')
checks['sdk_after_has_member'] = sdkAfter.includes('alpha') && sdkAfter.includes('beta')
const alphaDecl = (sdkAfter.match(/^ {2}alpha: /gm) ?? []).length
const betaDecl = (sdkAfter.match(/^ {2}beta: /gm) ?? []).length
checks['alpha_declared_once_per_interface'] = alphaDecl === 2
checks['beta_declared_once_per_interface'] = betaDecl === 2
checks['bindable'] = view.includes('alpha') && view.includes('beta')
checks['no_plan_b_section'] = !after.sections.some(s => s.name === 'tool-visibility:sdk')
const sources = after.sections.filter(s => (s.text ?? '').includes('alpha: ')).map(s => s.name)
checks['single_declaration_source'] = JSON.stringify(sources) === JSON.stringify(['tools:sdk'])
checks['disclosure_dispatched'] = disclosing.isError === false

const problems = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k)
console.log(JSON.stringify({ checks, alphaDecl, betaDecl, sources, sdkAfterSnippet: sdkAfter.split('\n').filter(l => /alpha: |beta: /.test(l)).slice(0, 4) }, null, 2))
if (problems.length > 0) { console.error('FAILED: ' + problems.join(',')); process.exit(1) }
console.log('M4 PASS')
process.exit(0)