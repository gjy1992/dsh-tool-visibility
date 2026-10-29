/**
 * 0.4.0 baseline fixture capture.
 * Source: the working copy of dsh-tool-visibility at package.json version 0.4.0.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const read = p => readFile(path.join(root, p), 'utf8')
const sha = s => createHash('sha256').update(s).digest('hex')

const pkgRaw = await read('package.json')
const pkg = JSON.parse(pkgRaw)
if (pkg.version !== '0.4.0') {
  console.error('expected version 0.4.0, got ' + pkg.version)
  process.exit(2)
}
const host = await read('src/index.js')
const client = await read('src/client.js')

const constTools = [...host.matchAll(/const ([A-Z_]+) = '([a-z_]+)'/g)]
  .filter(m => m[1].endsWith('_TOOL'))
  .map(m => m[2])
const literalTools = [...host.matchAll(/name:\s*'([a-z_]+)'/g)].map(m => m[1])
const registeredTools = [...new Set([...constTools, ...literalTools])].sort()

const uiElements = []
for (const [class_, label] of [['tvi-search',''],['tvi-btn','刷新'],['tvi-btn','全部恢复'],['tvi-group-head',''],['tvi-row',''],['set-group','']]) {
  const hit = label ? client.includes(label) : client.includes(class_)
  if (hit) uiElements.push(label ? class_ + ':' + label : class_)
}

const fixture = {
  version: pkg.version,
  sources: { 'src/index.js': sha(host), 'src/client.js': sha(client), 'package.json': sha(pkgRaw) },
  registeredTools,
  uiElements,
  capturedAt: new Date().toISOString(),
}
await mkdir(path.join(root, 'tests/fixtures'), { recursive: true })
await writeFile(path.join(root, 'tests/fixtures/baseline-0.4.0.json'), JSON.stringify(fixture, null, 2) + '\n', 'utf8')
console.log(JSON.stringify(fixture, null, 2))