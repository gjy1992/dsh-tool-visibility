# dsh-tool-visibility

> **本仓库 fork 自 [rayfalling/dsh-tool-visibility](https://github.com/rayfalling/dsh-tool-visibility)**（原仓库止于 0.3.4）。
> 自 0.4.0 起由本仓库独立演进：工具分组渐进披露、使用统计、scope-local restrict 容错、
> PTC 保留工具处理等，均以 `scripts/verify/*`、`scripts/probe/*` 跑通，验收过程记录在 `docs/`。
> 同步上游：`git fetch upstream && git rebase upstream/main`。

控制 DeepSeek Harness 中「注入模型上下文的工具清单」的**静态插件**：提供
**设置页 UI（Settings → 工具注入控制）**与模型侧管理工具 `tool_visibility`，可手动开关
每个 tool 定义是否注入模型上下文；隐藏集合持久化到 JSON 状态文件，重启自动恢复。
适合把纯工具类插件的几十个工具 schema 从每步模型请求里剔除，节省上下文。

> Static plugin: control which tool schemas are injected into the DSH model
> context. Browser settings page + `tool_visibility` manager tool; persisted
> state; framework-native `tools.restrict` filter.
>
> Compatible with DSH `^0.1.5-rc.2 || ^0.2.0-rc.1` (verified against
> **0.2.0-rc.2**, cordis 4.0.4, React 18).

## 原理

每步模型调用前，agent loop 通过 `systemPrompt.assemble()` 收集工具 schema（来自
`tools.schemas(scope)`），`assembly.tools` 即模型请求的 `tools` 字段。

本插件按优先级使用两种机制：

1. **`ctx.tools.restrict({ deny })`**（首选，框架原生）——作为 agent preset 行挂载时，
   restriction 注册在 preset scope，对本 preset 下的所有 agent 生效：被隐藏的工具 schema
   不再注入上下文，且调用会得到 `UNKNOWN_TOOL`。
2. **`system-prompt/assemble` waterfall 兜底**——仅当 `restrict` 不可用（如被挂在无 scope
   的 host 层，dsh 会抛 `tools.restrict() requires a scoped context`）时启用，从组装结果中
   剔除隐藏 schema（仅影响模型所见，不阻止执行）。

dsh ≥ 0.1.7-rc.1 的 `restrict` 还会拒绝**不在全局层**的工具名，分两类：

- **已不存在**（例如隐藏后卸载了对应插件）；
- **只在某个 agent scope 内注册**的工具（Agent Teams 的 Lead-only `spawn_teammate` /
  `team_task_*` 就是这种）。这类工具天生无法被全局 restriction 过滤。

dsh 会把所有被拒名字**一次性**列在同一句错误里（单个是 `unknown global tool "a"`，多个是
`unknown global tools "a", "b"`）。插件解析出全部名字、从 deny 集合里剔除后重试，并只对每个
名字打印一次「not restrictable here, left visible」提示；剩余工具照常生效。这样既不会因为一个
scope-local 名字把整组（乃至整个隐藏集合）降级成 waterfall 兜底，也不会每次 prompt 组装都刷屏。

### 保留工具（永不可隐藏）

- `tool_visibility`——本管理器自身，隐藏它会失去控制面；
- `run_code`——PTC 模式的保留传输工具。运行时会在任何「以代码呈现」的 scope 里把它注入
  `tools.schemas()`，而 `tools.register()` 拒绝注册该名字、`tools.restrict({ deny })`
  在 deny 里出现它时直接抛错。若把它放进隐藏集合，轻则整条 restriction 失效降级，
  重则（经 waterfall）把 PTC agent 唯一的调用通道从上下文里抹掉。

- `tool_visibility` 在设置页显示为「框架保留，始终注入」（勾选框禁用）；
- `run_code` **完全不进设置页**，也不出现在管理工具的 `list` 结果里——它是运行时管道，
  不是可管理的工具。

两者都不会进入 deny 集合（`restrict` 的输入、状态文件、waterfall 剔除名单均已过滤），
管理工具的 `hide` / `show` 也会拒绝它们；启动加载状态文件时会主动剔除这些名字。

## 表面（Surface）

- **浏览器设置页**：Settings → 工具注入控制。列出全部工具（可见 ∪ 已隐藏，隐藏的也能恢复），
  复选框逐工具开关；按名称前缀分组、支持搜索与整组批量开关；顶部有 刷新 / 全部恢复；
  显示状态文件路径与当前生效的过滤机制。
  Client↔Host 走 Connection RPC 通道 `/tool-visibility`（endpoints: `list` / `set` / `set-group` / `reset` / `usage-list` / `usage-reset`）。
  > 通道实现：本插件在同时注入 `webServer` + `connection` 的上下文里自行注册
  > `/tool-visibility` 前缀路由，复用 `connection.requestRejection()` 的
  > Host/Origin + 浏览器会话校验；报文与 `ctx.connection.rpc.call()` 使用的标准 Connection RPC
  > 信封逐字一致——请求 `{ type:'client-request', rpcId, method, payload }`（POST 到
  > `<channel>/<endpoint>`，`content-type: application/json`），响应
  > `{ type:'server-response', rpcId, result }`，`result` 为 `{ ok:true, value }` 或
  > `{ ok:false, error:{ code, message, details } }`（0.2.0-rc.2 核验）。client 半区无需改动。
  >
  > 该实现最初是为绕开 0.1.5-rc.1 上 `connection.rpc.handle()` 用通道服务自身 ctx 解析
  > `webServer`、导致第三方调用抛 `cannot get property "webServer" without inject` 的问题。
  > 0.2.0-rc.2 的 `connection.rpc.handle()` 已改为按**调用方 ctx** 解析 `webServer`，
  > 因此这是可选的收尾项（迁移到公共接口），不是兼容性要求。
- **模型工具** `tool_visibility`：`list` / `hide` / `show` / `reset`。
- **设置页 · 使用统计子 tab（0.6.0）**：按工具累计调用次数与失败次数、最近使用时间，
  **跨会话累积**（写入独立的 `tool-visibility-stats.json`，与过滤配置互不影响），
  默认按调用次数降序，支持按名称搜索，`清零统计` 按钮清空全部计数并立即落盘。
  每行给出状态（常驻 / 已隐藏 / 所属 group）与建议：
  从未调用且仍常驻 → *可考虑移入分组*；已隐藏却仍在调用 → *分组门槛可能过高*；
  已入组但调用 ≥20 次 → *建议常驻*。

## 使用统计的工作方式

采集在 `ctx.on('session/event')` 上做，只旁听、不改过滤行为：

- `tool/call` → 计数 +1（调用已发生即计入，即使结果永远不返回）；
- `tool/result` 带 `error` 或 `message.isError` → 失败数 +1；
- 结果事件不带工具名，用 `callId` 与 `tool/call` 配对；对不上号的（fork 重放别家会话的结果）忽略而不是猜测。

写入是防抖的（1.5s 合并一次，temp+rename 原子落盘），统计写失败只 `console.warn`，
绝不让一个诊断功能打断一轮对话。统计文件损坏时从空计数开始，不影响过滤器加载。

## 安装 / 挂载

作为 agent preset 的一行（推荐，获得 per-scope 过滤 + 设置页 UI）：

```yaml
# 在 <preset>/agent.cordis.yml 中追加（需先安装本包：dsh plugin add @rayfalling/dsh-tool-visibility）
- id: tool-visibility
  name: '@rayfalling/dsh-tool-visibility'
```

Client 半区由 web 端 `dsh.client` 表自动发现（`package.json` 的 `dsh.client` 字段 +
`./client` 出口）；`src/client.js` 即 `__ModuleLoader__` 格式的浏览器 bundle，**无需构建**。

## 持久化

默认 `$DSH_HOME/tool-visibility.json`（`~/.dsh/tool-visibility.json`），每次
`hide/show/reset` 后写盘，启动时加载。格式：

```json
{ "hidden": ["import_claude", "store_search"], "descriptions": { "import_claude": "…" } }
```

使用统计默认落在同目录的 `tool-visibility-stats.json`：

```json
{ "version": 1, "updatedAt": "2026-10-29T03:26:57.820Z", "tools": { "read": { "count": 12, "errors": 0, "firstUsedAt": "…", "lastUsedAt": "…" } } }
```

`descriptions` 是隐藏工具的描述缓存（供 UI 显示），可配置覆盖路径：

```yaml
- id: tool-visibility
  name: '@rayfalling/dsh-tool-visibility'
  config:
    stateFile: 'F:/my/state.json'
    usageFile: 'F:/my/tool-usage.json'   # 可选，默认与 stateFile 同目录
```

## 兼容性

| 项 | 值 |
|---|---|
| DSH host | `^0.1.5-rc.2 \|\| ^0.2.0-rc.1`（已对 0.2.0-rc.2 逐接口核验） |
| cordis | `^4.0.2`（0.2.0-rc.2 随附 4.0.4） |
| React（client 半区 `require('react')`） | `^18.2.0`（Web 平台模块表内置，无需打包） |
| 插件版本（本仓库自身 SemVer） | `0.4.0` |

dsh ≥ 0.1.7-rc.1 会在**安装与启动**时强制校验 `@deepseek-ai/dsh*` peer 范围：`^0.1.x` 的旧范围
在 0.2.0-rc.x 主机上会被判为不兼容，插件行**在启动时被静默禁用**（stderr 打印
`dsh: disabling profile plugin row ...`，`--dump-config` 仍会列出该行）。因此 0.4.0 起 peer
写成 `^0.1.5-rc.2 || ^0.2.0-rc.1`。

> 注意：`^0.2.0` 本身**不**接纳 `0.2.0-rc.x` 预发布版本（semver 展开为 `>=0.2.0 <0.3.0-0`），
> 必须写带预发布段的底 `^0.2.0-rc.1`。

## 开发

标准 cordis 插件包（ESM，命名导出 `name` / `inject` / `apply`；client 半区
`src/client.js` + `dsh.client` 字段；组合包 manifest `dsh.bundle` + `cordis.patch.yml`；
host 入口零静态 `@deepseek-ai/*` import，可在任意 profile 直接安装）。
本地安装验证：

```sh
dsh plugin --profile <name> add <本包路径>
dsh --profile <name> --dump-config   # 应看到本包层
```

仓库：<https://github.com/rayfalling/dsh-tool-visibility>（public，topics：`dsh` / `deepseek-harness` / `cordis` / `plugin` / `dsh-plugin`）。

## License

MIT

## 工具分组（渐进披露，0.5.0）

在 Settings → 工具注入控制 的「工具分组（渐进披露）」区块里定义分组：

```json
{ "groups": [ { "key": "docs", "label": "文档工具", "intro": "读写文档相关工具。", "members": ["read", "write"], "enabled": true } ] }
```

- **披露工具**：每个启用分组只注册一个 `group_<key>`，其 `description` **严格等于**该组 `intro`；
  组内成员在该 agent 的模型视图中缺席（`tools.restrict({deny})` 安装在每个 agent 的 scope 上）。
- **披露**：调用 `group_<key>` 后，该组未被 hidden 的成员在**同一会话的下一步**进入视图；
  披露状态只存内存、按 agent scope 隔离，**不写入 state 文件**，新会话/重启回到初始态。
- **hidden 优先**：hidden 是总开关，成员在 hidden 中时披露后仍不可见。
- **未归组工具**不受分组影响（始终按 hidden 规则显隐）；`run_code`、`tool_visibility` 既不能入组也不能隐藏。
- **已披露清单段**：披露后由 system prompt 段 `tool-visibility:disclosed` 输出「名 — 一句话介绍」，不写会话历史。
- **PTC**：`tools:sdk` 每步按 `view(scope)` 重算，披露后自动包含成员声明（无需 Plan B 纹理裁剪）。
- **写入语义**：`groups-save` 为原子整体替换；非法 key/重复 key/保留名/`group_*`/跨组引用 fail-closed；未知成员名在保存与加载均被忽略。

### 挂载

一行即可：根层 bundle 行或某个 agent preset 行，**不要两处同时挂载**（`group_<key>` 会重复注册）。
两种挂载均已实测：preset 平面（`docs/evidence/m4-preset-assembly.jsonl`）与根层平面（`docs/evidence/m5-real-session-assembly.jsonl`）。
