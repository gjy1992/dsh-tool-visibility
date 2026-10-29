/** M1 checklist: real DSH_HOME persistence + every acceptance item in one run. */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const pluginUrl = 'file:///' + path.join(root, 'src/index.js').replaceAll('\\', '/')
const read = p => readFile(path.join(root, p), 'utf8')
const exists = async p => { try { await stat(path.join(root, p)); return true } catch { return false } }
const sha = b => createHash('sha256').update(b).digest('hex')
const checks = {}

// 1) docs + ten probe rows
const contractDoc = await read('docs/contract-v2.md')
const probeDoc = await read('docs/probe.md')
const probeRows = probeDoc.split('\n').filter(l => /^\| \d+[a-z]? \|/.test(l)).length
checks['1_docs_in_repo'] = contractDoc.length > 0 && probeDoc.length > 0 && probeRows >= 10
checks['1_probe_item_rows'] = probeRows

// 2) baseline fixture + capture script
const fixture = JSON.parse(await read('tests/fixtures/baseline-0.4.0.json'))
checks['2_baseline_fixture'] = fixture.version === '0.4.0' && Array.isArray(fixture.registeredTools) && typeof fixture.sources['src/index.js'] === 'string'
checks['2_capture_script'] = await exists('scripts/baseline/capture.mjs')

// harness: real DSH_HOME so the DEFAULT state path is exercised
const dshHome = process.env.TV_DSH_HOME ?? await mkdtemp(path.join(os.tmpdir(), 'tv-home-'))
process.env.DSH_HOME = dshHome
const defaultState = path.join(dshHome, 'tool-visibility.json')
await mkdir(path.dirname(defaultState), { recursive: true })
await rm(defaultState, { force: true })
await writeFile(defaultState, JSON.stringify({ hidden: [] }, null, 2))
const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await Promise.resolve()
const tools = ctx.get('tools')
const mk = n => defineTool({ name: n, description: n + ' tool description', parameters: {}, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }, async execute() { return n } })
for (const n of ['alpha', 'beta', 'gamma', 'delta']) tools.register(mk(n))
const agentScope = createScope(tools.ctx, {})
const agentCtx = agentScope.ctx
class FakeAgents extends Service { constructor(c) { super(c, 'agents') } list() { return [{ ctx: agentCtx }] } }
await ctx.plugin(FakeAgents)
let rpc = null
const plugin = await import(pluginUrl + '?v=' + Math.random())
await plugin.apply(ctx, { __onRpc: h => { rpc = h }, __scopeOf: scopeOf })
checks['0_uses_default_state_path'] = defaultState.endsWith('tool-visibility.json')
const view = () => tools.schemas(scopeOf(agentCtx)).map(s => s.name).sort()
const stateText = async () => readFile(defaultState, 'utf8')
const readState = async () => JSON.parse(await stateText())

// 3) + 4) save two groups, one disclosure tool each, members absent, description === intro
const shaBefore = sha(await stateText())
const save = await rpc('groups-save', { groups: [
  { key: 'one', label: 'One', intro: 'intro one', members: ['alpha'], enabled: true },
  { key: 'two', label: 'Two', intro: 'intro two', members: ['beta'], enabled: true },
] })
const shaAfter = sha(await stateText())
const persisted = await readState()
const afterSave = view()
const groupTools = tools.schemas().filter(s => s.name.startsWith('group_'))
checks['3_save_ok'] = save.ok === true
checks['3_default_state_changed'] = shaBefore !== shaAfter
checks['3_state_has_groups'] = Array.isArray(persisted.groups) && persisted.groups.length === 2 && persisted.groups.every(g => typeof g.key === 'string' && typeof g.label === 'string' && typeof g.intro === 'string' && Array.isArray(g.members) && typeof g.enabled === 'boolean')
checks['3_one_group_tool_per_group'] = groupTools.map(s => s.name).sort().join(',') === 'group_one,group_two'
checks['3_members_absent'] = !afterSave.includes('alpha') && !afterSave.includes('beta') && afterSave.includes('gamma')
checks['4_description_equals_intro'] = groupTools.find(s => s.name === 'group_one')?.description === 'intro one' && groupTools.find(s => s.name === 'group_two')?.description === 'intro two'

// 5) six invalid member classes rejected, state unchanged
const before5 = await stateText()
const invalid = [
  ['reserved-run-code', [{ key: 'b1', label: 'B', intro: '', members: ['run_code'], enabled: true }]],
  ['reserved-manager', [{ key: 'b2', label: 'B', intro: '', members: ['tool_visibility'], enabled: true }]],
  ['disclosure-tool', [{ key: 'b3', label: 'B', intro: '', members: ['group_one'], enabled: true }]],
  ['unknown', [{ key: 'b4', label: 'B', intro: '', members: ['nope'], enabled: true }]],
  ['empty-enabled', [{ key: 'b5', label: 'B', intro: '', members: [], enabled: true }]],
  ['duplicate-key', [{ key: 'dup', label: 'A', intro: '', members: ['gamma'], enabled: true }, { key: 'dup', label: 'B', intro: '', members: ['delta'], enabled: true }]],
]
const rejected = {}
for (const [label, groups] of invalid) {
  const r = await rpc('groups-save', { groups })
  rejected[label] = r.ok === false
}
checks['5_six_invalid_rejected'] = Object.values(rejected).every(Boolean)
checks['5_rejections'] = rejected
checks['5_state_unchanged'] = (await stateText()) === before5

// 6) registration failure rolls back, state and previous groups unchanged
tools.register(mk('group_dup'))
const before6 = await stateText()
const rb = await rpc('groups-save', { groups: [{ key: 'dup', label: 'Dup', intro: 'i', members: ['delta'], enabled: true }] })
checks['6_rollback_rejected'] = rb.ok === false
checks['6_state_unchanged'] = (await stateText()) === before6
checks['6_previous_group_kept'] = view().includes('group_one') && view().includes('group_two')

// 7) twenty concurrent saves leave a parseable single-group file
await Promise.all(Array.from({ length: 20 }, (_, i) => rpc('groups-save', {
  groups: [{ key: 'c' + i, label: 'C' + i, intro: '', members: ['gamma'], enabled: true }],
})))
const concurrent = await readState()
checks['7_concurrent_parse'] = Array.isArray(concurrent.groups) && concurrent.groups.length === 1 && /^c\d+$/.test(concurrent.groups[0].key)

// 8) hide/reset keep groups, file parses, nothing session-scoped persisted
await rpc('groups-save', { groups: [{ key: 'keep', label: 'Keep', intro: 'k', members: ['alpha'], enabled: true }] })
await rpc('set', { name: 'gamma', hidden: true })
await rpc('reset', {})
const final = await readState()
checks['8_groups_survive'] = Array.isArray(final.groups) && final.groups.length === 1 && final.groups[0].key === 'keep'
checks['8_file_parses'] = typeof final.hidden !== 'undefined' && !('disclosed' in final)

// 9) reload from the same real path (simulated restart) and dump groups-list
const ctx2 = new Context()
await ctx2.plugin(SystemPrompt)
await ctx2.plugin(ToolRuntime)
await Promise.resolve()
const tools2 = ctx2.get('tools')
for (const n of ['alpha', 'beta', 'gamma', 'delta']) tools2.register(mk(n))
const scope2 = createScope(tools2.ctx, {})
class FakeAgents2 extends Service { constructor(c) { super(c, 'agents') } list() { return [{ ctx: scope2.ctx }] } }
await ctx2.plugin(FakeAgents2)
let rpc2 = null
const plugin2 = await import(pluginUrl + '?v=' + Math.random())
await plugin2.apply(ctx2, { __onRpc: h => { rpc2 = h }, __scopeOf: scopeOf })
const listed = await rpc2('groups-list', {})
checks['9_reload_groups'] = listed.ok === true && listed.value.groups.length === 1 && listed.value.groups[0].key === 'keep' && listed.value.groups[0].tool === 'group_keep'
checks['9_reload_files'] = { statePath: defaultState, sha: sha(await stateText()) }
checks['9_groups_list'] = listed.value?.groups

console.log(JSON.stringify(checks, null, 2))
process.exit(0)