import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await Promise.resolve()
const tools = ctx.get('tools')
tools.register(defineTool({ name: 'alpha', description: '', parameters: {}, output: { schema: { type: 'string' }, render: () => [] }, async execute(){return 'a'} }))
const sc = createScope(tools.ctx, {})
class Fake extends Service { constructor(c){super(c,'agents')} list(){ return [{ ctx: sc.ctx }] } }
await ctx.plugin(Fake)
try { sc.ctx.get('tools').restrict({ deny: ['alpha'] }); console.log('direct ok') } catch (e) { console.log('direct ERR', e.message.slice(0,90)) }
console.log('schemas', tools.schemas(scopeOf(sc.ctx)).map(s=>s.name))
process.exit(0)