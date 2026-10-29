/** AC4: native next-step visibility + PTC SDK declaration after disclosing a group. */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const pluginUrl = 'file:///' + path.join(root, 'src/index.js').replaceAll('\\', '/')
const problems = []

const state = { hidden: [], groups: [{ key: 'ga', label: 'A', intro: 'group a', members: ['alpha'], enabled: true }] }
const boot = async (ptc) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-ac4-'))
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
  const plugin = await import(pluginUrl + '?v=' + Math.random())
  await plugin.apply(ctx, { stateFile, __scopeOf: scopeOf })
  const view = () => tools.schemas(scopeOf(sc.ctx)).map(s => s.name).sort()
  const sdk = async () => {
    const asm = await sp.assemble({ scope: scopeOf(sc.ctx) })
    return asm.sections.find(s => s.name === 'tools:sdk')?.text ?? ''
  }
  const disclose = () => tools.execute({ signal: new AbortController().signal, callId: 'c1', name: 'group_ga', arguments: {}, agent, parent: 'ptc-probe' })
  return { view, sdk, disclose }
}

// native branch
const native = await boot(false)
const beforeN = native.view()
await native.disclose()
const afterN = native.view()
if (beforeN.includes('alpha')) problems.push('native: alpha visible before disclosure')
if (!afterN.includes('alpha')) problems.push('native: alpha missing after disclosure')

// PTC branch
const ptc = await boot(true)
const sdkBefore = await ptc.sdk()
await ptc.disclose()
const sdkAfter = await ptc.sdk()
if (sdkBefore.includes('alpha')) problems.push('ptc: SDK declares alpha before disclosure')
if (!sdkAfter.includes('alpha')) problems.push('ptc: SDK missing alpha after disclosure')
const decl = (sdkAfter.match(/^ {2}alpha: /gm) ?? []).length
if (decl !== 2) problems.push('ptc: expected one declaration per interface (2), got ' + decl)

if (problems.length > 0) {
  console.log(JSON.stringify({ problems, beforeN, afterN, sdkBeforeHasAlpha: sdkBefore.includes('alpha'), sdkAfterHasAlpha: sdkAfter.includes('alpha'), decl }, null, 2))
  process.exit(1)
}
console.log('AC4 PASS')
console.log(JSON.stringify({ nativeBefore: beforeN, nativeAfter: afterN, sdkBeforeHasAlpha: false, sdkAfterHasAlpha: true, memberDeclarationsPerInterface: decl }))
process.exit(0)