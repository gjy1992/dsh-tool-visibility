import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import AgentRegistry from 'file:///F:/gitProject/dsh/packages/core/agent/lib/index.js'

const report = {}
const ctx = new Context()
await ctx.plugin(SystemPrompt)

// fake PTC runtime so mode 'ptc' can project its SDK section
class FakePtc extends Service {
  constructor(c) { super(c, 'ptcRuntime') }
  language = 'typescript'
  isolation = 'process'
  programFormat = 'repl'
  executionInstructions = ''
  resolve(req) { return req }
  async run() { return { logs: [], value: undefined } }
  async release() {}
}
await ctx.plugin(FakePtc)
await ctx.plugin(ToolRuntime, { mode: 'ptc' })
await ctx.plugin(AgentRegistry)

await Promise.resolve()
const tools = ctx.get('tools')
const sp = ctx.get('systemPrompt')
const agents = ctx.get('agents')
report.agentsService = typeof agents
report.agentsList = typeof agents?.list === 'function' ? agents.list().length : 'no-list'

const mk = name => defineTool({ name, description: name + ' tool', parameters: {}, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }, async execute() { return name } })
tools.register(mk('alpha'))
tools.register(mk('beta'))

const s1 = createScope(tools.ctx, {})
const k1 = scopeOf(s1.ctx)
const assemble = async (scope) => {
  const a = await sp.assemble({ scope })
  const sdk = a.sections.find(s => s.name === 'tools:sdk')
  return { tools: a.tools.map(t => t.name).sort(), sdkHasAlpha: (sdk?.text ?? '').includes('alpha'), sdkLen: (sdk?.text ?? '').length }
}
report.ptcBefore = await assemble(k1)
const t1 = s1.ctx.get('tools')
const lift = t1.restrict({ deny: ['alpha'] })
report.ptcAfterRestrict = await assemble(k1)
lift()
report.ptcAfterLift = await assemble(k1)
// prompt section registered at scope, reading assemble context scope
try {
  s1.ctx.get('systemPrompt').section({ name: 'probe:section', order: 4990, text: (c) => 'SCOPED:' + String(c.scope === k1) })
  report.sectionReadsScope = (await assemble(k1)).tools.length >= 0
  const a = await sp.assemble({ scope: k1 })
  report.sectionText = a.sections.find(s => s.name === 'probe:section')?.text ?? '(absent)'
} catch (e) { report.sectionError = e.message.slice(0, 120) }
console.log(JSON.stringify(report, null, 2))
process.exit(0)
