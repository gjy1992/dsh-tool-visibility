import { Context } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'

const report = {}
const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await Promise.resolve()
const tools = ctx.get('tools')
const sp = ctx.get('systemPrompt')
const mk = name => defineTool({ name, description: name + ' tool', parameters: {}, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }, async execute() { return name } })

const s1 = createScope(tools.ctx, {})
const k1 = scopeOf(s1.ctx)
// scope-local registration
s1.ctx.get('tools').register(mk('gamma'))
report.scopeLocalVisible = tools.schemas(k1).map(s => s.name).sort()
try { s1.ctx.get('tools').restrict({ deny: ['gamma'] }); report.scopeLocalRestrict = 'allowed' }
catch (e) { report.scopeLocalRestrict = 'throws: ' + e.message.slice(0, 140) }

// root-level assemble waterfall strip (native mode)
tools.register(mk('alpha'))
report.nativeBefore = (await sp.assemble({ scope: k1 })).tools.map(t => t.name).sort()
let lifted = false
const dispose = ctx.on('system-prompt/assemble', async (_a, _c, next) => {
  const a = await next()
  return { ...a, tools: a.tools.filter(t => t.name !== 'alpha') }
}, { prepend: true })
report.nativeAfterWaterfall = (await sp.assemble({ scope: k1 })).tools.map(t => t.name).sort()
dispose()
report.nativeAfterDispose = (await sp.assemble({ scope: k1 })).tools.map(t => t.name).sort()
console.log(JSON.stringify(report, null, 2))
process.exit(0)
