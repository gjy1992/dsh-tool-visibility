/** AC6#0 file-hash: state has exactly {hidden, groups} and no disclosed/opened key. */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
const files = [
  'F:/gitProject/dsh-plugins/dsh-tool-visibility/tool-visibility.json',
  path.join(os.homedir(), '.dsh', 'tool-visibility.json'),
]
const out = []
for (const file of files) {
  const buf = await readFile(file)
  const parsed = JSON.parse(buf.toString('utf8'))
  out.push({
    path: file,
    sha256: createHash('sha256').update(buf).digest('hex'),
    keys: Object.keys(parsed).sort(),
    hasDisclosed: Object.prototype.hasOwnProperty.call(parsed, 'disclosed'),
    hasOpened: Object.prototype.hasOwnProperty.call(parsed, 'opened'),
    groupsIsArray: Array.isArray(parsed.groups),
  })
}
console.log(JSON.stringify(out, null, 2))
process.exit(out.every(e => e.hasDisclosed === false && e.hasOpened === false) ? 0 : 1)