/**
 * M11: concurrent writers.
 *
 * Two real OS processes load the same state file, then write at the same moment.
 * The cross-process lock must serialize the read-merge-write, the three-way merge
 * must keep both intents, and every failure path must leave no lock or temp file
 * behind.
 */
import { Context } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile, rm, utimes, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const pluginUrl = 'file:///' + path.join(root, 'src/index.js').replaceAll('\\', '/')
const workerPath = path.join(import.meta.dirname, 'm11-concurrency-worker.mjs')

let failures = 0
const assert = (n, v, d) => { if (!v) failures += 1; console.log(n + '=' + JSON.stringify(v) + (d === undefined ? '' : ' ' + d)) }
const exists = async (p) => { try { await stat(p); return true } catch { return false } }
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-m11-'))

/** Boot a plugin instance in this process (explicit state file keeps the home clean). */
async function localPlugin(stateFile, tools) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await Promise.resolve()
  for (const name of tools) {
    ctx.get('tools').register(defineTool({
      name,
      description: name + ' tool',
      parameters: {},
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: name }] },
      async execute() { return name },
    }))
  }
  let rpc = null
  const plugin = await import(pluginUrl + '?v=' + Math.random())
  await plugin.apply(ctx, { stateFile, usageFile: stateFile + '.stats.json', __onRpc: (hook) => { rpc = hook } })
  return { rpc }
}

/** Run two workers that loaded the same file and then write together. */
async function race(stateFile, label, left, right) {
  const base = path.join(dir, label)
  const goFile = base + '.go'
  const children = [left, right].map((spec, index) => {
    const ready = base + '-' + index + '.ready'
    const result = base + '-' + index + '.result.json'
    const args = ['--no-warnings', workerPath, stateFile, ready, goFile, spec.mode, spec.tool ?? '', result, stateFile + '.stats-' + index + '.json']
    return { ready, result, child: spawn(process.execPath, args, { stdio: 'inherit' }) }
  })
  const deadline = Date.now() + 20000
  for (const entry of children) {
    for (;;) {
      if (await exists(entry.ready)) break
      if (Date.now() > deadline) throw new Error('worker did not reach ready: ' + entry.ready)
      await sleep(20)
    }
  }
  await writeFile(goFile, 'go', 'utf8')
  const codes = await Promise.all(children.map((entry) => new Promise((resolve) => entry.child.on('exit', (code) => resolve(code)))))
  const results = []
  for (const entry of children) results.push(await readJson(entry.result).catch(() => null))
  return { codes, results }
}

const initialGroups = [{ key: 'ga', label: 'A', intro: 'intro A', members: ['alpha'], enabled: true }]

// ── 1. two hosts hide one tool each ──────────────────────────────────────────
const s1 = path.join(dir, 'race1.json')
await writeFile(s1, JSON.stringify({ hidden: [], groups: initialGroups }, null, 2) + '\n', 'utf8')
const r1 = await race(s1, 'race1', { mode: 'hide', tool: 'alpha' }, { mode: 'hide', tool: 'beta' })
const after1 = await readJson(s1)
assert('hide_race_both_survive', after1.hidden.join(',') === 'alpha,beta', JSON.stringify(after1.hidden))
assert('hide_race_groups_kept', JSON.stringify(after1.groups.map((g) => g.key)) === '["ga"]')
assert('hide_race_exit_codes', r1.codes.every((code) => code === 0), JSON.stringify(r1.codes))

// ── 2. one host saves groups while the other hides a tool ────────────────────
const s2 = path.join(dir, 'race2.json')
await writeFile(s2, JSON.stringify({ hidden: [], groups: initialGroups }, null, 2) + '\n', 'utf8')
const r2 = await race(s2, 'race2', { mode: 'groups' }, { mode: 'hide', tool: 'beta' })
const after2 = await readJson(s2)
assert('groups_and_hide_both_survive', after2.hidden.includes('beta'), JSON.stringify(after2.hidden))
assert('groups_save_survived', after2.groups.length === 1 && after2.groups[0].intro === 'intro A v2', JSON.stringify(after2.groups))
assert('groups_race_exit_codes', r2.codes.every((code) => code === 0), JSON.stringify(r2.codes))
assert('no_lock_left', !(await exists(s2 + '.lock')))
assert('no_temp_left', !(await readdir(dir)).some((entry) => entry.includes('.tmp-')))

// ── 3. stale lock (dead owner) is taken over ─────────────────────────────────
const s3 = path.join(dir, 'stale.json')
await writeFile(s3, JSON.stringify({ hidden: [], groups: initialGroups }, null, 2) + '\n', 'utf8')
await writeFile(s3 + '.lock', JSON.stringify({ pid: 2147483647, hostname: os.hostname(), nonce: 'dead', startedAt: new Date(0).toISOString() }), 'utf8')
const { rpc: rpc3 } = await localPlugin(s3, ['alpha', 'beta'])
const staleResult = await rpc3('set', { name: 'alpha', hidden: true })
assert('stale_lock_taken_over', staleResult.ok === true && staleResult.value.persistError === null, JSON.stringify(staleResult.value && staleResult.value.persistError))
assert('stale_lock_write_applied', (await readJson(s3)).hidden.join(',') === 'alpha')
assert('stale_lock_removed', !(await exists(s3 + '.lock')))

// ── 4. a live lock makes this host refuse to write ───────────────────────────
const s4 = path.join(dir, 'busy.json')
await writeFile(s4, JSON.stringify({ hidden: [], groups: initialGroups }, null, 2) + '\n', 'utf8')
await writeFile(s4 + '.lock', JSON.stringify({ pid: process.pid, hostname: os.hostname(), nonce: 'live', startedAt: new Date().toISOString() }), 'utf8')
const before4 = await readFile(s4, 'utf8')
const { rpc: rpc4 } = await localPlugin(s4, ['alpha', 'beta'])
const startedAt = Date.now()
const busy = await rpc4('set', { name: 'beta', hidden: true })
const tookMs = Date.now() - startedAt
assert('busy_lock_refused', busy.ok === true && typeof busy.value.persistError === 'string' && busy.value.persistError.includes('locked by another process'), JSON.stringify(busy.value && busy.value.persistError))
assert('busy_lock_waited', tookMs >= 1800, tookMs + 'ms')
assert('busy_lock_file_untouched', (await readFile(s4, 'utf8')) === before4)
assert('busy_lock_kept_owners_lock', await exists(s4 + '.lock'))

// ── 5. an aged, unreadable lock is reclaimed (crash between create and write) ─
const s5 = path.join(dir, 'aged.json')
await writeFile(s5, JSON.stringify({ hidden: [], groups: initialGroups }, null, 2) + '\n', 'utf8')
await writeFile(s5 + '.lock', '', 'utf8')
const old = new Date(Date.now() - 120000)
await utimes(s5 + '.lock', old, old)
const { rpc: rpc5 } = await localPlugin(s5, ['alpha', 'beta'])
const aged = await rpc5('set', { name: 'alpha', hidden: true })
assert('aged_empty_lock_reclaimed', aged.ok === true && aged.value.persistError === null, JSON.stringify(aged.value && aged.value.persistError))

// ── 6. a fresh empty lock is NOT stolen (owner may still be writing it) ──────
const s6 = path.join(dir, 'fresh.json')
await writeFile(s6, JSON.stringify({ hidden: [], groups: initialGroups }, null, 2) + '\n', 'utf8')
await writeFile(s6 + '.lock', '', 'utf8')
const { rpc: rpc6 } = await localPlugin(s6, ['alpha', 'beta'])
const freshStarted = Date.now()
const fresh = await rpc6('set', { name: 'alpha', hidden: true })
assert('fresh_empty_lock_respected', Date.now() - freshStarted >= 1800 && String(fresh.value.persistError || '').includes('locked by another process'), JSON.stringify(fresh.value && fresh.value.persistError))

await rm(dir, { recursive: true, force: true })
console.log(failures === 0 ? 'M11 PASS' : 'M11 FAIL (' + failures + ')')
process.exit(failures === 0 ? 0 : 1)
