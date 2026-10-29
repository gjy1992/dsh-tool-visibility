import { Context } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const warnings = []
const originalWarn = console.warn
console.warn = (...args) => { warnings.push(args.join(' ')) }

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
const tools = ctx.get('tools')
const mk = name => defineTool({ name, description: name + ' desc', parameters: {}, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }, async execute() { return name } })
tools.register(mk('alpha'))
tools.register(mk('beta'))
tools.register(mk('gamma'))

// Mint an agent scope and put a scope-local (Lead-only) tool inside it: this is
// exactly what Agent Teams does with spawn_teammate / team_task_*.
const key = { id: 'agent-a' }
let scope
await ctx.plugin(Object.assign((inner) => { scope = createScope(inner, key) }, { inject: ['tools', 'systemPrompt'] }))
scope.ctx.tools.register(mk('spawn_teammate'))

const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-restrict-'))
const stateFile = path.join(dir, 'state.json')
await writeFile(stateFile, JSON.stringify({
  hidden: ['gamma'],
  groups: [{ key: 'team', label: 'Team', intro: 'team tools', members: ['spawn_teammate', 'beta'], enabled: true }],
}, null, 2))

const plugin = await import('file:///F:/gitProject/dsh-plugins/dsh-tool-visibility/src/index.js')
await plugin.apply(ctx, { stateFile })

// Agent lifecycle: the visibility plugin installs the per-agent restriction here.
const agent = { ctx: scope.ctx }
ctx.emit('agent/created', { agent })
const seen = scope.ctx.tools.schemas(key).map(s => s.name).sort()

// A second install (every prompt assembly re-asserts it) must stay silent.
ctx.emit('agent/created', { agent })
const seenAgain = scope.ctx.tools.schemas(key).map(s => s.name).sort()

// Disclosure: calling group_team opens the group for THIS agent scope.
await tools.execute({ signal: new AbortController().signal, callId: 'c1', name: 'group_team', arguments: {}, agent })
const afterDisclosure = scope.ctx.tools.schemas(key).map(s => s.name).sort()

const droppedWarnings = warnings.filter(w => w.includes('not restrictable'))
const failures = warnings.filter(w => w.includes('restriction failed'))
const stateAfter = JSON.parse(await readFile(stateFile, 'utf8'))
console.warn = originalWarn
const out = JSON.stringify({
  seen, seenAgain, afterDisclosure,
  dropWarnings: droppedWarnings,
  failures,
  persistGroups: stateAfter.groups?.map(g => g.key),
}, null, 2)

// ── scenario B: the hidden-set filter (applyFilter) meets the same plural error ──
const warningsB = []
console.warn = (...args) => { warningsB.push(args.join(' ')) }
const ctxB = new Context()
await ctxB.plugin(SystemPrompt)
await ctxB.plugin(ToolRuntime)
const toolsB = ctxB.get('tools')
toolsB.register(mk('shared_b'))
let scopeB
const keyB = { id: 'agent-b' }
await ctxB.plugin(Object.assign((inner) => { scopeB = createScope(inner, keyB) }, { inject: ['tools', 'systemPrompt'] }))
scopeB.ctx.tools.register(mk('ghost_local'))
const stateFileB = path.join(dir, 'state-b.json')
await writeFile(stateFileB, JSON.stringify({ hidden: ['ghost_local', 'shared_b'] }, null, 2))
await plugin.apply(scopeB.ctx, { stateFile: stateFileB })
const seenB = ctxB.tools.schemas(keyB).map(s => s.name).sort()
console.warn = originalWarn
console.log(JSON.stringify({
  A: JSON.parse(out),
  B: { seen: seenB, warnings: warningsB },
}, null, 2))
process.exit(0)
