import { Context } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await Promise.resolve()
const tools = ctx.get('tools')
const mk = name => defineTool({ name, description: name + ' desc', parameters: {}, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }, async execute() { return name } })
tools.register(mk('alpha'))
tools.register(mk('beta'))

const dir = await mkdtemp(path.join(os.tmpdir(), 'tv-'))
const stateFile = path.join(dir, 'state.json')
await writeFile(stateFile, JSON.stringify({
  hidden: ['beta'],
  futureField: { keep: true },
  groups: [{ key: 'docs', label: 'Docs', intro: 'doc tools', members: ['alpha', 'run_code', 'group_x', 'nope'], enabled: true, extra: 1 }],
}, null, 2))

const plugin = await import('file:///F:/gitProject/dsh-plugins/dsh-tool-visibility/src/index.js')
await plugin.apply(ctx, { stateFile })
const names = tools.schemas().map(s => s.name).sort()
const g = tools.schemas().find(s => s.name === 'group_docs')
const state = JSON.parse(await (await import('node:fs/promises')).readFile(stateFile, 'utf8'))
console.log(JSON.stringify({ names, groupDesc: g?.description, persistedGroups: state.groups, futureField: state.futureField, groupToolName: state.groups?.[0]?.key }, null, 2))
process.exit(0)
