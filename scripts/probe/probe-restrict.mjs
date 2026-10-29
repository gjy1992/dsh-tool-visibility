import { Context } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)

const mk = name => defineTool({
  name, description: name + ' tool', parameters: {},
  output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
  async execute() { return name },
})

const report = {}
const run = async (tools) => {
  tools.register(mk('alpha'))
  tools.register(mk('beta'))
  const s1 = createScope(tools.ctx, {})
  const s2 = createScope(tools.ctx, {})
  const k1 = scopeOf(s1.ctx), k2 = scopeOf(s2.ctx)
  const names = k => tools.schemas(k).map(s => s.name).sort()
  report.scopeDistinct = k1 !== k2 && k1 !== undefined
  report.global = names(undefined)
  report.s1Init = names(k1)
  report.s2Init = names(k2)
  const t1 = s1.ctx.get('tools')
  const lift1 = t1.restrict({ deny: ['alpha'] })
  report.afterDenyAlpha_s1 = names(k1)
  report.afterDenyAlpha_s2 = names(k2)
  const lift2 = t1.restrict({ deny: ['beta'] })
  report.afterDenyBeta_s1 = names(k1)
  lift2()
  report.afterLift2_s1 = names(k1)
  lift1()
  report.afterLift1_s1 = names(k1)
  try { const gl = tools.restrict({ deny: ['alpha'] }); report.globalRestrict = 'allowed'; gl() } catch (e) { report.globalRestrict = 'throws: ' + e.message.slice(0, 80) }
}
await Promise.resolve()
const _tools = ctx.get('tools')
console.log('service:', typeof _tools)
await run(_tools)
console.log(JSON.stringify(report, null, 2))
process.exit(0)
