/**
 * M10: per-profile state file.
 *
 * - inside a dsh-launched profile the state file is <profile.dir>/tool-visibility.json
 * - a profile's first start adopts the legacy $DSH_HOME file (copy, never move)
 * - an existing profile file is never overwritten by adoption
 * - no profileContext keeps the legacy global path
 * - an explicit stateFile wins and disables adoption
 * - usage statistics stay installation-global unless stateFile is explicit
 */
import { Context } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const pluginUrl = 'file:///' + path.join(root, 'src/index.js').replaceAll('\\', '/')

let failures = 0
const assert = (n, v, d) => { if (!v) failures += 1; console.log(n + '=' + JSON.stringify(v) + (d === undefined ? '' : ' ' + d)) }
const exists = async (p) => { try { await stat(p); return true } catch { return false } }
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))

const home = await mkdtemp(path.join(os.tmpdir(), 'tv-m10-'))
process.env.DSH_HOME = home
const legacy = path.join(home, 'tool-visibility.json')
const legacyState = { hidden: [], groups: [{ key: 'legacy', label: 'Legacy', intro: 'legacy intro', members: [], enabled: true }] }
await writeFile(legacy, JSON.stringify(legacyState, null, 2) + '\n', 'utf8')

/** Fresh host fixture; `profile` omitted = no profileContext at all. */
async function boot(config, profile) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await Promise.resolve()
  if (profile !== undefined) ctx.provide('profileContext', profile)
  let rpc = null
  const plugin = await import(pluginUrl + '?v=' + Math.random())
  await plugin.apply(ctx, { ...config, __onRpc: (h) => { rpc = h } })
  const groups = await rpc('groups-list', {})
  const usage = await rpc('usage-list', {})
  return { ctx, rpc, stateFile: groups.value && groups.value.stateFile, usageFile: usage.value && usage.value.usageFile, listed: groups.value && groups.value.groups }
}

/** A profile directory plus the launch facts dsh provides for it. */
const makeProfile = async (name) => {
  const dir = path.join(home, 'profiles', name)
  await mkdir(dir, { recursive: true })
  return { name, dir, patchPath: path.join(dir, 'cordis.patch.yml'), installAnchor: path.join(home, 'package.json'), cwd: home, home, startedBundles: [], overlays: [] }
}

// 1. profile default path + adoption of the legacy file
const web = await makeProfile('web')
const webFile = path.join(web.dir, 'tool-visibility.json')
const a = await boot({}, web)
assert('profile_default_path', a.stateFile === webFile, a.stateFile)
assert('adopted_file_created', await exists(webFile))
assert('adopted_content_identical', JSON.stringify(await readJson(webFile)) === JSON.stringify(await readJson(legacy)))
assert('adopted_group_visible', a.listed.map((g) => g.key).join(',') === 'legacy', JSON.stringify(a.listed.map((g) => g.key)))
assert('legacy_file_kept', await exists(legacy))
assert('adoption_does_not_touch_other_profiles', !(await exists(path.join(home, 'profiles', 'headless', 'tool-visibility.json'))))
assert('usage_global_with_profile', a.usageFile === path.join(home, 'tool-visibility-stats.json'), a.usageFile)

// 2. second profile adopts the same legacy file independently, with its own copy
const headless = await makeProfile('headless')
const b = await boot({}, headless)
assert('second_profile_own_file', b.stateFile === path.join(headless.dir, 'tool-visibility.json'))
assert('second_profile_adopted', b.listed.map((g) => g.key).join(',') === 'legacy')

// 3. an existing profile file is never replaced by adoption
const existing = { hidden: [], groups: [{ key: 'mine', label: 'Mine', intro: 'mine', members: [], enabled: true }] }
await writeFile(webFile, JSON.stringify(existing, null, 2) + '\n', 'utf8')
const c = await boot({}, web)
assert('existing_profile_file_kept', JSON.stringify(await readJson(webFile)) === JSON.stringify(existing))
assert('existing_groups_loaded', c.listed.map((g) => g.key).join(',') === 'mine', JSON.stringify(c.listed.map((g) => g.key)))

// 4. no profileContext -> legacy global path (unchanged behaviour)
const d = await boot({})
assert('no_profile_uses_legacy_path', d.stateFile === legacy, d.stateFile)
assert('no_profile_no_profile_file', !(await exists(path.join(home, 'profiles', 'web', 'tool-visibility.json.bak'))))

// 5. explicit stateFile wins and disables adoption
const custom = path.join(home, 'custom', 'state.json')
const e = await boot({ stateFile: custom }, web)
assert('explicit_state_file_wins', e.stateFile === custom, e.stateFile)
assert('explicit_state_file_not_prefilled', !(await exists(custom)))
assert('explicit_state_file_usage_beside_it', e.usageFile === path.join(path.dirname(custom), 'tool-visibility-stats.json'), e.usageFile)

// 6. a corrupt legacy file is never propagated
const home2 = await mkdtemp(path.join(os.tmpdir(), 'tv-m10-corrupt-'))
process.env.DSH_HOME = home2
await writeFile(path.join(home2, 'tool-visibility.json'), '{not json', 'utf8')
const dir2 = path.join(home2, 'profiles', 'p')
await mkdir(dir2, { recursive: true })
const f = await boot({}, { name: 'p', dir: dir2, patchPath: path.join(dir2, 'cordis.patch.yml'), installAnchor: path.join(home2, 'package.json'), cwd: home2, home: home2, startedBundles: [], overlays: [] })
assert('corrupt_legacy_not_copied', !(await exists(path.join(dir2, 'tool-visibility.json'))))
assert('corrupt_legacy_starts_empty', (f.listed || []).length === 0, JSON.stringify(f.listed))

console.log(failures === 0 ? 'M10 PASS' : 'M10 FAIL (' + failures + ')')
process.exit(failures === 0 ? 0 : 1)
