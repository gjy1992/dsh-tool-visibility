/** M5: disclosed-tools prompt section — per-entry name+intro, intro edits, hidden, dedupe. */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')
const pluginUrl = 'file:///' + path.join(root, 'src/index.js').replaceAll('\\', '/')
let failures = 0
const assert = (name, value, detail) => { if (!value) failures += 1; console.log(name + '=' + JSON.stringify(value) + (detail === undefined ? '' : ' ' + detail)) }

const boot = async (state, ptc) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-m5-'))
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
  const mk = n => defineTool({ name: n, description: n + ' tool description.', parameters: {}, output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: n }] }, async execute() { return n } })
  for (const n of ['alpha', 'beta', 'gamma']) tools.register(mk(n))
  const sc = createScope(tools.ctx, {})
  const session = { appended: 0, append() { this.appended += 1 } }
  const agent = { id: 'A', ctx: sc.ctx, session }
  class Agents extends Service { constructor(c) { super(c, 'agents') } list() { return [agent] } }
  await ctx.plugin(Agents)
  let rpc = null
  const plugin = await import(pluginUrl + '?v=' + Math.random())
  await plugin.apply(ctx, { stateFile, __onRpc: h => { rpc = h }, __scopeOf: scopeOf })
  const section = async () => {
    const asm = await sp.assemble({ scope: scopeOf(sc.ctx) })
    return asm.sections.find(x => x.name === 'tool-visibility:disclosed')?.text ?? ''
  }
  const disclose = (name) => tools.execute({ signal: new AbortController().signal, callId: 'c' + Math.random().toString(36).slice(2), name, arguments: {}, agent, parent: 'p' })
  return { ctx, tools, sp, rpc, section, disclose, session, agent }
}

const state = { hidden: [], groups: [
  { key: 'ga', label: 'A', intro: 'group a intro。second', members: ['alpha'], enabled: true },
  { key: 'gb', label: 'B', intro: 'group b intro', members: ['alpha', 'beta'], enabled: true },
] }

for (const ptc of [false, true]) {
  const h = await boot(state, ptc)
  const tag = ptc ? 'ptc' : 'native'
  assert(tag + '_section_before_empty', (await h.section()) === '')
  await h.disclose('group_ga')
  let text = await h.section()
  assert(tag + '_has_alpha_line', text.includes('- alpha — group a intro'))
  await h.disclose('group_gb')
  text = await h.section()
  const lines = text.split('\n').filter(l => l.startsWith('- '))
  assert(tag + '_dedupe_alpha_once', lines.filter(l => l.includes('alpha')).length === 1, JSON.stringify(lines))
  assert(tag + '_has_beta_line', lines.some(l => l.includes('beta') && l.includes('group b intro')))
  assert(tag + '_messages_unchanged', h.session.appended === 0)
  // intro edit
  await h.rpc('groups-save', { groups: [
    { key: 'ga', label: 'A', intro: 'edited intro for A', members: ['alpha'], enabled: true },
    { key: 'gb', label: 'B', intro: 'group b intro', members: ['alpha', 'beta'], enabled: true },
  ] })
  text = await h.section()
  assert(tag + '_intro_edit_reflected', text.includes('edited intro for A'))
  // hidden member row absent
  await h.rpc('set', { name: 'beta', hidden: true })
  text = await h.section()
  assert(tag + '_hidden_member_row_absent', !text.split('\n').some(l => l.startsWith('- beta')))
}

if (failures > 0) { console.error('M5 FAIL failures=' + failures); process.exit(1) }
console.log('M5 PASS')
process.exit(0)