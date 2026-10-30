/** M9: cross-session tool usage statistics — counting, error attribution, persistence, reset, suggestions. */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')
const pluginUrl = 'file:///' + path.join(root, 'src/index.js').replaceAll('\\', '/')
let failures = 0
const assert = (name, value, detail) => { if (!value) failures += 1; console.log((value ? 'PASS ' : 'FAIL ') + name + '=' + JSON.stringify(value) + (detail === undefined ? '' : ' ' + detail)) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const boot = async ({ dir, state }) => {
  const stateFile = path.join(dir, 'tool-visibility.json')
  const usageFile = path.join(dir, 'tool-visibility-stats.json')
  if (state) await writeFile(stateFile, JSON.stringify(state))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await Promise.resolve()
  const tools = ctx.get('tools')
  const mk = (n) => defineTool({ name: n, description: n + ' tool description.', parameters: {}, output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: n }] }, async execute() { return n } })
  for (const n of ['alpha', 'beta', 'gamma']) tools.register(mk(n))
  const sc = createScope(tools.ctx, {})
  const session = { appended: 0, append() { this.appended += 1 } }
  const agent = { id: 'A', ctx: sc.ctx, session }
  class Agents extends Service { constructor(c) { super(c, 'agents') } list() { return [agent] } }
  await ctx.plugin(Agents)
  let rpc = null
  const plugin = await import(pluginUrl + '?v=' + Math.random())
  await plugin.apply(ctx, { stateFile, usageFile, __onRpc: (h) => { rpc = h }, __scopeOf: scopeOf })
  const emit = (type, data) => ctx.emit('session/event', session, { type, seq: 1, time: 1, data })
  const call = (name, callId) => emit('tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' })
  const result = (callId, failed) => emit('tool/result', {
    turn: 1, step: 1,
    message: { role: 'tool', toolCallId: callId, isError: failed === true, content: [] },
    ...(failed === true ? { error: { name: 'ToolError', code: 'internal' } } : {}),
  })
  const ptcStart = (name, subCallId) => emit('tool/ptc-dispatch-start', { rootCallId: 'r1', parentCallId: 'p1', subCallId, name, arguments: {} })
  const ptcSettle = (subCallId, failed) => emit('tool/ptc-dispatch', {
    rootCallId: 'r1', parentCallId: 'p1', subCallId, name: 'x', arguments: {},
    isError: failed === true, content: [],
    ...(failed === true ? { error: { name: 'ToolError', code: 'internal' } } : {}),
  })
  return { ctx, tools, rpc, usageFile, stateFile, call, result, emit, ptcStart, ptcSettle }
}

const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-m9-'))
const state = { hidden: ['gamma'], groups: [{ key: 'ga', label: 'A', intro: 'a', members: ['beta'], enabled: true }] }

// ── 1. empty start: catalogue rows with zero counts ────────────────────────────
{
  const h = await boot({ dir, state })
  const listed = await h.rpc('usage-list', {})
  assert('initial_ok', listed.ok === true)
  const rows = listed.value.rows
  assert('initial_row_count', rows.length >= 3, JSON.stringify(rows.map(r => r.name)))
  const alpha = rows.find((r) => r.name === 'alpha')
  assert('initial_alpha_zero', alpha.count === 0 && alpha.errors === 0)
  assert('initial_alpha_suggests_group', /移入分组/.test(alpha.suggestion), JSON.stringify(alpha.suggestion))
  const gamma = rows.find((r) => r.name === 'gamma')
  assert('hidden_tool_has_no_suggestion', gamma.suggestion === '', JSON.stringify(gamma.suggestion))
  const beta = rows.find((r) => r.name === 'beta')
  assert('grouped_tool_lists_membership', Array.isArray(beta.memberOf) && beta.memberOf.includes('group_ga'), JSON.stringify(beta.memberOf))
}

// ── 2. counting, error attribution, persistence across a restart ──────────────
const shared = await mkdtemp(path.join(os.tmpdir(), 'tv-m9b-'))
{
  const h = await boot({ dir: shared, state })
  h.call('alpha', 'c1'); h.result('c1', false)
  h.call('alpha', 'c2'); h.result('c2', true)
  h.call('beta', 'c3'); h.result('c3', false)
  // A call whose result never arrives must still be counted.
  h.call('alpha', 'c4')
  // A result with no seen call (fork replay) must not invent a counter.
  h.result('ghost', true)

  const listed = await h.rpc('usage-list', {})
  const rows = listed.value.rows
  const alpha = rows.find((r) => r.name === 'alpha')
  const beta = rows.find((r) => r.name === 'beta')
  assert('alpha_count_three', alpha.count === 3, JSON.stringify(alpha))
  assert('alpha_errors_one', alpha.errors === 1, JSON.stringify(alpha))
  assert('beta_count_one', beta.count === 1)
  assert('ghost_not_counted', rows.find((r) => r.name === 'ghost') === undefined)
  assert('sorted_by_count_desc', rows[0].name === 'alpha', JSON.stringify(rows.map((r) => r.name)))
  assert('last_used_set', typeof alpha.lastUsedAt === 'string' && alpha.lastUsedAt.length > 0)

  await sleep(2000)
  const persisted = JSON.parse(await readFile(h.usageFile, 'utf8'))
  assert('persisted_alpha', persisted.tools.alpha.count === 3 && persisted.tools.alpha.errors === 1, JSON.stringify(persisted.tools.alpha))
  assert('persisted_version', persisted.version === 1)

  // Restart against the same directory: counters must survive (cross-session).
  const again = await boot({ dir: shared })
  const reloaded = (await again.rpc('usage-list', {})).value.rows
  const alpha2 = reloaded.find((r) => r.name === 'alpha')
  assert('survives_restart', alpha2.count === 3 && alpha2.errors === 1, JSON.stringify(alpha2))

  // A further call accumulates on top of the loaded history.
  again.call('alpha', 'c9'); again.result('c9', false)
  const third = (await again.rpc('usage-list', {})).value.rows.find((r) => r.name === 'alpha')
  assert('accumulates_after_restart', third.count === 4 && third.errors === 1, JSON.stringify(third))

  // ── 3. reset clears counters but never the filter configuration ─────────────
  const beforeReset = JSON.parse(await readFile(again.stateFile, 'utf8'))
  const reset = await again.rpc('usage-reset', {})
  assert('reset_ok', reset.ok === true)
  const afterReset = reset.value.rows.find((r) => r.name === 'alpha')
  assert('reset_zeroes_counts', afterReset.count === 0 && afterReset.errors === 0, JSON.stringify(afterReset))
  const onDisk = JSON.parse(await readFile(again.usageFile, 'utf8'))
  assert('reset_persisted', Object.values(onDisk.tools).every((e) => e.count === 0), JSON.stringify(onDisk.tools))
  const stateAfter = JSON.parse(await readFile(again.stateFile, 'utf8'))
  assert('reset_keeps_hidden', JSON.stringify(stateAfter.hidden) === JSON.stringify(beforeReset.hidden), JSON.stringify(stateAfter.hidden))
  assert('reset_keeps_groups', JSON.stringify(stateAfter.groups) === JSON.stringify(beforeReset.groups))

  // A subsequent call after a reset starts from zero, not from the stale memory.
  again.call('beta', 'c10'); again.result('c10', false)
  const post = (await again.rpc('usage-list', {})).value.rows.find((r) => r.name === 'beta')
  assert('count_after_reset', post.count === 1, JSON.stringify(post))
}

// ── 3b. suggestion: a grouped tool called often should be promoted to resident ─
{
  const h = await boot({ dir, state })
  for (let i = 0; i < 20; i += 1) { h.call('beta', 'b' + i); h.result('b' + i, false) }
  const beta = (await h.rpc('usage-list', {})).value.rows.find((r) => r.name === 'beta')
  assert('hot_grouped_suggests_resident', /建议常驻/.test(beta.suggestion), JSON.stringify(beta.suggestion))
  for (let i = 0; i < 3; i += 1) { h.call('gamma', 'g' + i); h.result('g' + i, false) }
  const gamma = (await h.rpc('usage-list', {})).value.rows.find((r) => r.name === 'gamma')
  assert('hidden_but_called_warns', /门槛可能过高/.test(gamma.suggestion), JSON.stringify(gamma.suggestion))
}

// ── 3c. PTC mode: sub-dispatches counted, the run_code transport is not ───────
{
  const dir2 = await mkdtemp(path.join(os.tmpdir(), 'tv-m9c-'))
  const h = await boot({ dir: dir2, state })
  // A PTC turn: one run_code call whose program dispatches three real tools.
  h.call('run_code', 'rc1')
  h.ptcStart('alpha', 'rc1:ptc:1'); h.ptcSettle('rc1:ptc:1', false)
  h.ptcStart('beta', 'rc1:ptc:2'); h.ptcSettle('rc1:ptc:2', true)
  h.ptcStart('alpha', 'rc1:ptc:3'); h.ptcSettle('rc1:ptc:3', false)
  h.result('rc1', false)

  const rows = (await h.rpc('usage-list', {})).value.rows
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
  assert('ptc_transport_not_counted', byName.run_code === undefined, JSON.stringify(Object.keys(byName)))
  assert('ptc_alpha_two', byName.alpha.count === 2 && byName.alpha.errors === 0, JSON.stringify(byName.alpha))
  assert('ptc_beta_one_with_error', byName.beta.count === 1 && byName.beta.errors === 1, JSON.stringify(byName.beta))

  // A nested run_code (SDK re-entry) is transport too, never a tool use.
  h.ptcStart('run_code', 'nested-rc')
  h.ptcSettle('nested-rc', false)
  const after = (await h.rpc('usage-list', {})).value.rows
  assert('nested_run_code_ignored', after.every((r) => r.name !== 'run_code'))

  // Mixed session: native calls and PTC calls accumulate into the same counters.
  h.call('alpha', 'native1'); h.result('native1', false)
  const mixed = (await h.rpc('usage-list', {})).value.rows.find((r) => r.name === 'alpha')
  assert('mixed_native_and_ptc', mixed.count === 3, JSON.stringify(mixed))
}

// ── 4. unknown endpoint still rejected ─────────────────────────────────────────
{
  const h = await boot({ dir, state })
  const bad = await h.rpc('usage-nope', {})
  assert('unknown_endpoint_rejected', bad.ok === false && bad.error.code === 'bad-request')
}

console.log(failures === 0 ? 'M9 PASS' : 'M9 FAIL (' + failures + ')')
process.exit(failures === 0 ? 0 : 1)
