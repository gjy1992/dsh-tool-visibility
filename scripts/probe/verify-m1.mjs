/** M1 verification: group model, save/rollback, concurrency, agent-scope deny. */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await Promise.resolve()
const tools = ctx.get('tools')
const mk = name => defineTool({ name, description: name + ' desc', parameters: {}, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }, async execute() { return name } })
for (const n of ['alpha', 'beta', 'gamma', 'delta']) tools.register(mk(n))

const agentScope = createScope(tools.ctx, {})
const agentCtx = agentScope.ctx
const fakeAgents = [{ ctx: agentCtx }]
class FakeAgents extends Service {
  constructor(c) { super(c, 'agents') }
  list() { return fakeAgents }
}
await ctx.plugin(FakeAgents)

const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-m1-'))
const stateFile = path.join(dir, 'state.json')
await writeFile(stateFile, JSON.stringify({ hidden: [], futureField: { keep: true } }, null, 2))

const plugin = await import('file:///F:/gitProject/dsh-plugins/dsh-tool-visibility/src/index.js')
let rpc = null
await plugin.apply(ctx, { stateFile, __onRpc: h => { rpc = h }, __scopeOf: scopeOf })
const scopeNames = () => tools.schemas(scopeOf(agentCtx)).map(s => s.name).sort()
const readState = async () => JSON.parse(await readFile(stateFile, 'utf8'))
const out = {}

// 1) save a valid group: one group_* appears, members absent for the agent scope
out.initialAgentView = scopeNames()
let res = await rpc('groups-save', { groups: [{ key: 'docs', label: 'Docs', intro: 'doc tools', members: ['alpha', 'beta'], enabled: true }] })
out.saveOk = res.ok
out.agentViewAfterSave = scopeNames()
out.groupInGlobal = tools.schemas().map(s => s.name).filter(n => n.startsWith('group_'))
out.descriptionMatchesIntro = tools.schemas().find(s => s.name === 'group_docs')?.description === 'doc tools'

// 2) invalid member classes are rejected and the file is untouched
const before = JSON.stringify(await readState())
const bad = [
  ['reserved', ['run_code']],
  ['reserved-manager', ['tool_visibility']],
  ['disclosure-tool', ['group_docs']],
  ['unknown', ['nope']],
  ['empty-enabled', []],
]
out.rejections = {}
for (const [label, members] of bad) {
  const r = await rpc('groups-save', { groups: [{ key: 'x1', label: 'X', intro: '', members, enabled: true }] })
  out.rejections[label] = r.ok === false
}
out.stateUnchangedAfterReject = JSON.stringify(await readState()) === before

// 3) rollback when registration fails (pre-existing group_dup tool blocks the name)
tools.register(mk('group_dup'))
const beforeRollback = JSON.stringify(await readState())
const rb = await rpc('groups-save', { groups: [{ key: 'dup', label: 'Dup', intro: 'i', members: ['gamma'], enabled: true }] })
out.rollbackRejected = rb.ok === false
out.rollbackStateUnchanged = JSON.stringify(await readState()) === beforeRollback
out.rollbackKeptOldGroup = tools.schemas().some(s => s.name === 'group_docs')

// 4) 20 concurrent saves: file stays parseable and holds a valid configuration
await Promise.all(Array.from({ length: 20 }, (_, i) => rpc('groups-save', {
  groups: [{ key: 'c' + i, label: 'C' + i, intro: 'i' + i, members: ['gamma'], enabled: true }],
})))
let concurrentOk = false
try { const s = await readState(); concurrentOk = Array.isArray(s.groups) && s.groups.length === 1 && /^c\d+$/.test(s.groups[0].key) } catch { concurrentOk = false }
out.concurrentWriteParses = concurrentOk

// 5) groups-save then hide/reset keeps groups
await rpc('groups-save', { groups: [{ key: 'keep', label: 'Keep', intro: 'k', members: ['alpha'], enabled: true }] })
await rpc('set', { name: 'gamma', hidden: true })
let afterHide = await readState()
out.groupsSurviveHide = Array.isArray(afterHide.groups) && afterHide.groups.length === 1 && afterHide.futureField?.keep === true
await rpc('reset', {})
let afterReset = await readState()
out.groupsSurviveReset = Array.isArray(afterReset.groups) && afterReset.groups.length === 1
out.noDisclosurePersisted = !('disclosed' in afterReset) && !('opened' in afterReset)

console.log(JSON.stringify(out, null, 2))
process.exit(0)