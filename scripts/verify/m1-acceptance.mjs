/** M1 acceptance artifacts: real state file written by groups-save, restart reload, AC3/AC8 assertions. */
import { Context, Service } from 'file:///F:/gitProject/dsh/vendor/cordis/lib/index.js'
import SystemPrompt from 'file:///F:/gitProject/dsh/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineTool } from 'file:///F:/gitProject/dsh/packages/core/tools/lib/index.js'
import { createScope, scopeOf } from 'file:///F:/gitProject/dsh/packages/core/scope/lib/index.js'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const stateFile = path.join(root, 'tests/fixtures/state-with-groups.json')
const sha = buf => createHash('sha256').update(buf).digest('hex')
const pluginUrl = 'file:///' + path.join(root, 'src/index.js').replaceAll('\\', '/')
const shaOf = async () => sha(await readFile(stateFile))
const setup = async (statePath) => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await Promise.resolve()
  const tools = ctx.get('tools')
  const mk = n => defineTool({ name: n, description: n + ' tool description', parameters: {}, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }, async execute() { return n } })
  for (const n of ['alpha', 'beta', 'gamma']) tools.register(mk(n))
  const agentScope = createScope(tools.ctx, {})
  const agentCtx = agentScope.ctx
  class FakeAgents extends Service {
    constructor(c) { super(c, 'agents') }
    list() { return [{ ctx: agentCtx }] }
  }
  await ctx.plugin(FakeAgents)
  let rpc = null
  const plugin = await import(pluginUrl + '?v=' + Math.random())
  await plugin.apply(ctx, { stateFile: statePath, __onRpc: h => { rpc = h }, __scopeOf: scopeOf })
  return { tools, agentCtx, rpc }
}

await mkdir(path.dirname(stateFile), { recursive: true })
await rm(stateFile, { force: true })
await writeFile(stateFile, JSON.stringify({ hidden: [], note: 'fixture' }, null, 2) + '\n', 'utf8')
const before = await shaOf()
const first = await setup(stateFile)
const saved = await first.rpc('groups-save', { groups: [{ key: 'docs', label: '文档工具', intro: 'doc tools 组介绍', members: ['alpha', 'beta'], enabled: true }] })
const after = await shaOf()
const parsed = JSON.parse(await readFile(stateFile, 'utf8'))

const second = await setup(stateFile)
const view = second.tools.schemas(scopeOf(second.agentCtx)).map(s => s.name).sort()
const groupTools = second.tools.schemas().filter(s => s.name.startsWith('group_')).map(s => ({ name: s.name, description: s.description }))

const beforeAc8 = await shaOf()
const ac8 = await second.rpc('groups-save', { groups: [{ key: 'bad', label: 'B', intro: '', members: ['run_code'], enabled: true }] })
const afterAc8 = await shaOf()

console.log(JSON.stringify({
  savedOk: saved.ok === true,
  stateShaBefore: before,
  stateShaAfter: after,
  stateChanged: before !== after,
  groupsIsArray: Array.isArray(parsed.groups),
  groupEntry: parsed.groups?.[0] && { key: parsed.groups[0].key, label: parsed.groups[0].label, intro: parsed.groups[0].intro, members: parsed.groups[0].members, enabled: parsed.groups[0].enabled },
  unknownTopLevelKept: parsed.note,
  afterRestartAgentView: view,
  afterRestartGroupTools: groupTools,
  descriptionEqualsIntro: groupTools.length === 1 && groupTools[0].description === 'doc tools 组介绍',
  membersAbsent: view.includes('group_docs') && !view.includes('alpha') && !view.includes('beta'),
  ungroupedVisible: view.includes('gamma'),
  ac8Rejected: ac8.ok === false,
  ac8StateUnchanged: beforeAc8 === afterAc8,
}, null, 2))
process.exit(0)