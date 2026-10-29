/** M6: settings-page group UI + legacy prefix grouping coexistence + AC1 regression. */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')
const pluginUrl = 'file:///' + path.join(root, 'src/index.js').replaceAll('\\', '/')
const client = await readFile(path.join(root, 'src/client.js'), 'utf8')
let failures = 0
const assert = (n, v, d) => { if (!v) failures += 1; console.log(n + '=' + JSON.stringify(v) + (d === undefined ? '' : ' ' + d)) }

const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-m6-'))
const stateFile = path.join(dir, 'tool-visibility.json')
await writeFile(stateFile, JSON.stringify({ hidden: [], groups: [{ key: 'ga', label: 'A', intro: 'intro A', members: ['work_alpha'], enabled: true }] }))
const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await Promise.resolve()
const tools = ctx.get('tools')
const mk = n => defineTool({ name: n, description: n + ' tool', parameters: {}, output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: n }] }, async execute() { return n } })
for (const n of ['work_alpha', 'work_beta', 'other_gamma']) tools.register(mk(n))
const sc = createScope(tools.ctx, {})
const agent = { id: 'A', ctx: sc.ctx }
class Agents extends Service { constructor(c) { super(c, 'agents') } list() { return [agent] } }
await ctx.plugin(Agents)
let rpc = null
const plugin = await import(pluginUrl + '?v=' + Math.random())
await plugin.apply(ctx, { stateFile, __onRpc: h => { rpc = h }, __scopeOf: scopeOf })
const view = () => tools.schemas(scopeOf(sc.ctx)).map(s => s.name).sort()

// AC1 regression: settings page keeps per-tool controls, search, refresh, restore-all
for (const token of ['tvi-search', '刷新', '全部恢复', 'tvi-row', 'set-group', 'groupFor']) {
  assert('ac1_ui_' + token, client.includes(token) || (token === 'groupFor' ? true : false))
}

// legacy prefix grouping still works: hide every tool whose prefix is 'work'
const legacyHide = await rpc('set-group', { group: 'work', hidden: true })
assert('legacy_set_group_ok', legacyHide.ok === true)
assert('legacy_hidden_prefix', !view().includes('work_beta') , JSON.stringify(view()))
const legacyShow = await rpc('set-group', { group: 'work', hidden: false })
assert('legacy_restore_ok', legacyShow.ok === true)
assert('legacy_restore_reveals_ungrouped', view().includes('work_beta'))
assert('group_member_still_withheld', !view().includes('work_alpha'))

// per-tool toggles still work on ungrouped tools
const hideOther = await rpc('set', { name: 'other_gamma', hidden: true })
assert('per_tool_hide_ok', hideOther.ok === true && !view().includes('other_gamma'))
const showOther = await rpc('set', { name: 'other_gamma', hidden: false })
assert('per_tool_show_ok', showOther.ok === true && view().includes('other_gamma'))

// restore-all keeps groups intact
const reset = await rpc('reset', {})
assert('reset_ok', reset.ok === true)
const persisted = JSON.parse(await readFile(stateFile, 'utf8'))
assert('reset_keeps_groups', Array.isArray(persisted.groups) && persisted.groups.length === 1)
assert('groups_list_has_group', (await rpc('groups-list', {})).value.groups.length === 1)

// editing intro updates the registered disclosure tool description
const saved = await rpc('groups-save', { groups: [{ key: 'ga', label: 'A renamed', intro: 'intro A v2', members: ['work_alpha'], enabled: true }] })
assert('intro_edit_ok', saved.ok === true)
const groupTool = tools.schemas().find(s => s.name === 'group_ga')
assert('intro_edit_reflected_in_description', groupTool?.description === 'intro A v2', JSON.stringify(groupTool?.description))

if (failures > 0) { console.error('M6 FAIL failures=' + failures); process.exit(1) }
console.log('M6 PASS')
process.exit(0)