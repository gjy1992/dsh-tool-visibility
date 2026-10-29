/** M4 preset acceptance: explicit per-item assertions for AC3/AC4 (native + PTC). */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')
const pluginUrl = 'file:///' + path.join(root, 'src/index.js').replaceAll('\\', '/')
const state = { hidden: [], groups: [
  { key: 'ga', label: 'A', intro: 'group a intro', members: ['alpha', 'beta'], enabled: true },
  { key: 'gb', label: 'B', intro: 'group b intro', members: ['gamma'], enabled: true },
  { key: 'gc', label: 'C (disabled)', intro: 'group c intro', members: ['delta'], enabled: false },
] }
let failures = 0
const assert = (name, value, detail) => {
  if (!value) failures += 1
  console.log(name + '=' + JSON.stringify(value) + (detail === undefined ? '' : ' ' + detail))
}

const boot = async (ptc) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-m4p-'))
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
  for (const n of ['alpha', 'beta', 'gamma', 'delta']) tools.register(mk(n))
  const sc = createScope(tools.ctx, {})
  const agent = { id: 'A', ctx: sc.ctx }
  class Agents extends Service { constructor(c) { super(c, 'agents') } list() { return [agent] } }
  await ctx.plugin(Agents)
  const plugin = await import(pluginUrl + '?v=' + Math.random())
  await plugin.apply(ctx, { stateFile, __scopeOf: scopeOf })
  const view = () => tools.schemas(scopeOf(sc.ctx)).map(s => s.name).sort()
  const allSchemas = () => tools.schemas()
  const assemble = () => sp.assemble({ scope: scopeOf(sc.ctx) })
  const disclose = () => tools.execute({ signal: new AbortController().signal, callId: 'c1', name: 'group_ga', arguments: {}, agent, parent: 'ptc' })
  return { ctx, tools, sp, agent, view, allSchemas, assemble, disclose }
}

// ── AC3 judged items ────────────────────────────────────────────────────────
const n = await boot(false)
const schemasBefore = n.view()
assert('schemas_before', schemasBefore)  // ungrouped ∪ {group_ga}
const groupTools = schemasBefore.filter(x => x.startsWith('group_'))
assert('group_tools', groupTools, '(expected [group_ga, group_gb])')
assert('group_count', groupTools.length, '(expected 2)')
assert('no_disabled_group_tool', !groupTools.includes('group_gc'))
assert('enabled_members_absent_before', !schemasBefore.includes('alpha') && !schemasBefore.includes('beta') && !schemasBefore.includes('gamma'))
assert('disabled_group_member_visible', schemasBefore.includes('delta'))
const gw = n.allSchemas()
assert('desc_equal_ga', gw.find(s => s.name === 'group_ga')?.description === state.groups[0].intro)
assert('desc_equal_gb', gw.find(s => s.name === 'group_gb')?.description === state.groups[1].intro)

// ── AC4 native branch ──────────────────────────────────────────────────────
const assemblyN = await n.assemble()
const assemblyNSnapshot = JSON.stringify(assemblyN.tools.map(t => t.name).sort())
await n.disclose()
const nativeAfter = n.view()
assert('native_after', nativeAfter)
assert('native_members_visible', nativeAfter.includes('alpha') && nativeAfter.includes('beta'))
const assemblyNRecheck = JSON.stringify(assemblyN.tools.map(t => t.name).sort())
assert('assembly_n_unchanged', assemblyNRecheck === assemblyNSnapshot)

// ── AC4 PTC branch ─────────────────────────────────────────────────────────
const p = await boot(true)
const pBefore = await p.assemble()
const sdkBefore = pBefore.sections.find(s => s.name === 'tools:sdk')?.text ?? ''
await p.disclose()
const pAfter = await p.assemble()
const sdkAfter = pAfter.sections.find(s => s.name === 'tools:sdk')?.text ?? ''
assert('ptc_wire', pAfter.tools.map(t => t.name))
assert('ptc_sdk_before_has_no_member', !sdkBefore.includes('alpha') && !sdkBefore.includes('beta'))
assert('ptc_sdk_after_has_members', sdkAfter.includes('alpha') && sdkAfter.includes('beta'))
assert('alpha_declarations', (sdkAfter.match(/^ {2}alpha: /gm) ?? []).length, '(expected 2)')
assert('beta_declarations', (sdkAfter.match(/^ {2}beta: /gm) ?? []).length, '(expected 2)')
const sources = pAfter.sections.filter(s => (s.text ?? '').includes('alpha: ')).map(s => s.name)
assert('single_declaration_source', sources)
assert('ptc_bindable', p.view().includes('alpha') && p.view().includes('beta'))

if (failures > 0) { console.error('M4 FAIL failures=' + failures); process.exit(1) }
console.log('M4 PASS')
process.exit(0)