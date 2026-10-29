/** M2 / AC4 PTC branch: SDK text before vs after disclosure, exactly-once declarations. */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

class FakePtc extends Service {
  constructor(c) { super(c, 'ptcRuntime') }
  language = 'typescript'; isolation = 'process'; programFormat = 'function-body'
  executionInstructions = ''
  resolve(req) { return req }
  async run() { return { logs: [], value: undefined } }
  async release() {}
}

const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-ptc-'))
const stateFile = path.join(dir, 'tool-visibility.json')
await writeFile(stateFile, JSON.stringify({ hidden: [], groups: [{ key: 'ga', label: 'A', intro: 'group a', members: ['alpha'], enabled: true }] }))

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(FakePtc)
await ctx.plugin(ToolRuntime, { mode: 'ptc' })
await Promise.resolve()
const tools = ctx.get('tools')
const sp = ctx.get('systemPrompt')
const mk = n => defineTool({ name: n, description: n + ' tool', parameters: {}, output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: n }] }, async execute() { return n } })
tools.register(mk('alpha'))
tools.register(mk('gamma'))
const sc = createScope(tools.ctx, {})
// 'both' is a per-scope presentation: SDK section present AND direct calls tolerated,
// which is what lets a single script observe the SDK before/after a disclosure.
sc.ctx.get('tools').presentAs('both')
await Promise.resolve()
const agent = { id: 'A', ctx: sc.ctx }
class Agents extends Service { constructor(c) { super(c, 'agents') } list() { return [agent] } }
await ctx.plugin(Agents)
const plugin = await import('file:///F:/gitProject/dsh-plugins/dsh-tool-visibility/src/index.js?v=' + Math.random())
await plugin.apply(ctx, { stateFile, __scopeOf: scopeOf })

const sdkOf = async () => {
  const asm = await sp.assemble({ scope: scopeOf(sc.ctx) })
  const sdk = asm.sections.find(s => s.name === 'tools:sdk')?.text ?? ''
  return { wire: asm.tools.map(t => t.name).sort(), sdk, countAlpha: (sdk.match(/alpha/g) ?? []).length }
}
const before = await sdkOf()
const disp = await tools.execute({ signal: new AbortController().signal, callId: 'c1', name: 'group_ga', arguments: {}, agent, parent: 'ptc-probe' })
console.error('dispatch isError=', disp.isError, disp.isError ? disp.error.message : '')
const after = await sdkOf()
const view = tools.schemas(scopeOf(sc.ctx)).map(s => s.name).sort()
console.log(JSON.stringify({
  wireBefore: before.wire, sdkBeforeHasAlpha: before.sdk.includes('alpha'), sdkBeforeMemberDeclLines: before.memberDeclLines,
  wireAfter: after.wire, sdkAfterHasAlpha: after.sdk.includes('alpha'), alphaDeclarations: after.countAlpha, sdkAfterMemberDeclLines: after.memberDeclLines, sdkInterfaces: after.interfaces,
  bindableAlpha: view.includes('alpha'),
  sdkBeforeSnippet: before.sdk.slice(0, 160), sdkAfterSnippet: after.sdk.split('\n').filter(l => l.includes('alpha')).slice(0, 3),
}, null, 2))
process.exit(0)