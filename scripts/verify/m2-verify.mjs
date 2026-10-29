/** M2 verification: disclosure timing, session isolation, cleanup, unknown members, hidden precedence. */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const stateDir = await mkdtemp(path.join(os.tmpdir(), 'tv-m2-'))
const stateFile = path.join(stateDir, 'tool-visibility.json')
const checks = {}

async function boot(state) {
  await writeFile(stateFile, JSON.stringify(state, null, 2))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await Promise.resolve()
  const tools = ctx.get('tools')
  const sp = ctx.get('systemPrompt')
  const mk = n => defineTool({ name: n, description: n + ' tool', parameters: {}, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }, async execute() { return n } })
  for (const n of ['alpha', 'beta', 'gamma', 'delta']) tools.register(mk(n))
  const scopes = { A: createScope(tools.ctx, {}), B: createScope(tools.ctx, {}) }
  const agents = [{ id: 'A', ctx: scopes.A.ctx }, { id: 'B', ctx: scopes.B.ctx }]
  class Agents extends Service { constructor(c) { super(c, 'agents') } list() { return agents } }
  await ctx.plugin(Agents)
  let rpc = null
  const plugin = await import('file:///F:/gitProject/dsh-plugins/dsh-tool-visibility/src/index.js?v=' + Math.random())
  await plugin.apply(ctx, { stateFile, __onRpc: h => { rpc = h }, __scopeOf: scopeOf })
  const view = who => tools.schemas(scopeOf(agents.find(a => a.id === who).ctx)).map(s => s.name).sort()
  const disclose = async (who, groupTool) => {
    const agent = agents.find(a => a.id === who)
    return tools.execute({ signal: new AbortController().signal, callId: 'c-' + Math.random().toString(36).slice(2), name: groupTool, arguments: {}, agent })
  }
  return { ctx, tools, sp, agents, rpc, view, disclose, scopes }
}

const base = { hidden: [], groups: [
  { key: 'ga', label: 'A', intro: 'group a', members: ['alpha'], enabled: true },
  { key: 'gb', label: 'B', intro: 'group b', members: ['beta'], enabled: true },
] }
const h = await boot(base)

// 1) N -> N+1 timing
const stepN = h.view('A')
const assemblyN = await h.sp.assemble({ scope: scopeOf(h.agents[0].ctx) })
const disclosure = await h.disclose('A', 'group_ga')
const stepN1 = h.view('A')
const assemblyN1 = await h.sp.assemble({ scope: scopeOf(h.agents[0].ctx) })
checks['1_disclosure_ok'] = disclosure.isError === false
checks['1_stepN_before'] = stepN
checks['1_previous_assembly_unchanged'] = !assemblyN.tools.some(t => t.name === 'alpha')
checks['1_next_assembly_has_member'] = assemblyN1.tools.some(t => t.name === 'alpha')
checks['1_stepN1_has_member'] = stepN1.includes('alpha') && !stepN.includes('alpha')

// 3) second group + repeated disclosure does not stack
await h.disclose('A', 'group_gb')
await h.disclose('A', 'group_ga')
const afterBoth = h.view('A')
checks['3_both_visible'] = afterBoth.includes('alpha') && afterBoth.includes('beta')
checks['3_no_duplicates'] = new Set(afterBoth).size === afterBoth.length

// 2) session isolation
checks['2_B_isolated'] = !h.view('B').includes('alpha') && !h.view('B').includes('beta')
await h.disclose('B', 'group_ga')
checks['2_B_only_alpha'] = h.view('B').includes('alpha') && !h.view('B').includes('beta')

// 6) fresh agent session: exact set = enabled group_* ∪ ungrouped (minus hidden)
const C = createScope(h.tools.ctx, {})
h.agents.push({ id: 'C', ctx: C.ctx })
await h.sp.assemble({ scope: scopeOf(C.ctx) })
const viewC = h.tools.schemas(scopeOf(C.ctx)).map(s => s.name).sort()
checks['6_new_session_view'] = viewC
checks['6_exact'] = JSON.stringify(viewC) === JSON.stringify(['delta', 'gamma', 'group_ga', 'group_gb', 'tool_visibility'])

// 4) delete group: members no longer denied, disclosure tool gone
const del = await h.rpc('groups-save', { groups: [base.groups[1]] })
checks['4_delete_ok'] = del.ok === true
checks['4_group_tool_gone'] = !h.tools.schemas().some(s => s.name === 'group_ga')
checks['4_member_visible_again'] = h.view('C').includes('alpha')


// 7) legacy hidden wins over disclosure
const h2 = await boot({ hidden: ['gamma'], groups: [{ key: 'gc', label: 'C', intro: 'group c', members: ['gamma'], enabled: true }] })
await h2.disclose('A', 'group_gc')
const assembly = await h2.sp.assemble({ scope: scopeOf(h2.agents[0].ctx) })
checks['7_hidden_after_disclose'] = !assembly.tools.some(t => t.name === 'gamma')

// 5) unknown member on load is ignored without error
const h3 = await boot({ hidden: [], groups: [{ key: 'gx', label: 'X', intro: 'x', members: ['alpha', 'nope'], enabled: true }] })
const listed = await h3.rpc('groups-list', {})
checks['5_unknown_ignored'] = listed.ok === true && listed.value.groups[0].members.join(',') === 'alpha'
checks['5_boot_ok'] = h3.tools.schemas().some(s => s.name === 'group_gx')

// 5b) unknown member on SAVE is ignored, not rejected (AC9 save path)
const saveUnknown = await h3.rpc('groups-save', { groups: [{ key: 'gy', label: 'Y', intro: 'y', members: ['alpha', 'ghost_tool'], enabled: true }] })
const savedGroups = await h3.rpc('groups-list', {})
const savedGroup = savedGroups.value.groups.find(g => g.key === 'gy')
const persistedText = await readFile(stateFile, 'utf8').catch(() => '')
checks['5b_save_unknown_ignored'] = saveUnknown.ok === true
checks['5b_members'] = savedGroup?.members.join(',') === 'alpha'
checks['5b_no_ghost_persisted'] = !String(persistedText).includes('ghost_tool')


console.log(JSON.stringify(checks, null, 2))
process.exit(0)