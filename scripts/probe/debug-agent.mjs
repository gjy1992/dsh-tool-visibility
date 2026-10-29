import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await Promise.resolve()
const tools = ctx.get('tools')
const mk = n => defineTool({ name: n, description: '', parameters: {}, output: { schema: { type: 'string' }, render: () => [] }, async execute() { return n } })
tools.register(mk('alpha'))
const s = createScope(tools.ctx, {})
console.log('scopeKey', scopeOf(s.ctx) !== undefined)
console.log('get tools', typeof s.ctx.get('tools'))
try { s.ctx.get('tools').restrict({ deny: ['alpha'] }); console.log('restricted ok', tools.schemas(scopeOf(s.ctx)).map(x=>x.name)) } catch (e) { console.log('restrict err', e.message) }
process.exit(0)