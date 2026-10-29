/** M8: end-to-end acceptance run for AC1–AC9. */
import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')
const run = (file) => {
  try {
    const out = execFileSync(process.execPath, [path.join(root, file)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: out.trim() }
  } catch (error) {
    return { ok: false, out: String(error.stdout ?? '') + String(error.stderr ?? '') }
  }
}
const results = []
const row = (ac, check, ok, detail) => { results.push({ ac, check, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + ac + ' ' + check + (detail ? ' :: ' + detail : '')) }

// AC1
const ac1 = run('scripts/verify/ac1.mjs')
row('AC1', 'node scripts/verify/ac1.mjs', ac1.ok && ac1.out.includes('AC1 PASS'))

// AC2 artifact
const statePath = 'C:/Users/<user>/.dsh/tool-visibility.json'
let artifactOk = false, artifactDetail = ''
try {
  const parsed = JSON.parse(await readFile(statePath, 'utf8'))
  artifactOk = Array.isArray(parsed.groups) && parsed.groups.length > 0
    && parsed.groups.every(g => typeof g.key === 'string' && 'label' in g && 'intro' in g && Array.isArray(g.members))
  artifactDetail = statePath + ' groups=' + parsed.groups.length
} catch (error) { artifactDetail = String(error.message) }
row('AC2', 'artifact ' + statePath, artifactOk, artifactDetail)

// AC3 command
const ac3 = run('scripts/verify/ac3-entry.mjs')
row('AC3', 'node scripts/verify/ac3-entry.mjs', ac3.ok && ac3.out.includes('function'))
const m4 = run('scripts/verify/m4-preset.mjs')
row('AC3', 'node scripts/verify/m4-preset.mjs', m4.ok && m4.out.includes('M4 PASS'))

// AC4
const ac4 = run('scripts/verify/ac4.mjs')
row('AC4', 'node scripts/verify/ac4.mjs', ac4.ok && ac4.out.includes('AC4 PASS'))

// AC5
const ac5 = run('scripts/verify/ac5.mjs')
row('AC5', 'node scripts/verify/ac5.mjs', ac5.ok && ac5.out.includes('AC5 PASS'))
const m5 = run('scripts/verify/m5-verify.mjs')
row('AC5', 'node scripts/verify/m5-verify.mjs', m5.ok && m5.out.includes('M5 PASS'))

// AC6
let ac6Ok = false, ac6Detail = ''
try {
  const text = await readFile(statePath, 'utf8')
  ac6Ok = !/disclosed|opened/i.test(text)
  ac6Detail = 'no disclosed/opened key'
} catch (error) { ac6Detail = String(error.message) }
row('AC6', 'state file has no disclosed/opened', ac6Ok, ac6Detail)
const m2 = run('scripts/verify/m2-verify.mjs')
row('AC6', 'node scripts/verify/m2-verify.mjs (6_exact)', m2.ok && m2.out.includes('"6_exact": true'))

// AC7
const ac7 = run('scripts/verify/ac7.mjs')
row('AC7', 'node scripts/verify/ac7.mjs', ac7.ok && ac7.out.includes('AC7 PASS'))

// AC8
const ac8 = run('scripts/verify/ac8.mjs')
row('AC8', 'node scripts/verify/ac8.mjs', ac8.ok && ac8.out.includes('AC8 PASS'))

// AC9
const m3 = run('scripts/verify/m3-verify.mjs')
row('AC9', 'delete + unknown members (m2/m3 suites)', m2.ok && m2.out.includes('4_group_tool_gone') && m2.out.includes('5b_save_unknown_ignored'))
row('AC9', 'node scripts/verify/m3-verify.mjs', m3.ok && m3.out.includes('M3 PASS'))

// M9 (0.6.0): cross-session usage statistics
const m9 = run('scripts/verify/m9-usage.mjs')
row('M9', 'node scripts/verify/m9-usage.mjs', m9.ok && m9.out.includes('M9 PASS'), m9.ok ? '' : m9.out.slice(-400))

const failed = results.filter(r => !r.ok)
console.log('')
console.log('SUMMARY total=' + results.length + ' failed=' + failed.length)
if (failed.length > 0) { console.error('M8 FAIL: ' + failed.map(f => f.ac + '/' + f.check).join(', ')); process.exit(1) }
console.log('M8 PASS')
process.exit(0)