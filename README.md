# dsh-tool-visibility

控制 DeepSeek Harness 中「注入模型上下文的工具清单」的**静态插件**：提供
**设置页 UI（Settings → 工具注入控制）**与模型侧管理工具 `tool_visibility`，可手动开关
每个 tool 定义是否注入模型上下文；隐藏集合持久化到 JSON 状态文件，重启自动恢复。
适合把纯工具类插件的几十个工具 schema 从每步模型请求里剔除，节省上下文。

> Static plugin: control which tool schemas are injected into the DSH model
> context. Browser settings page + `tool_visibility` manager tool; persisted
> state; framework-native `tools.restrict` filter.

## 原理

每步模型调用前，agent loop 通过 `systemPrompt.assemble()` 收集工具 schema（来自
`tools.schemas(scope)`），`assembly.tools` 即模型请求的 `tools` 字段。

本插件按优先级使用两种机制：

1. **`ctx.tools.restrict({ deny })`**（首选，框架原生）——作为 agent preset 行挂载时，
   restriction 注册在 preset scope，对本 preset 下的所有 agent 生效：被隐藏的工具 schema
   不再注入上下文，且调用会得到 `UNKNOWN_TOOL`。
2. **`system-prompt/assemble` waterfall 兜底**——仅当 `restrict` 不可用（如被挂在无 scope
   的 host 层）时启用，从组装结果中剔除隐藏 schema（仅影响模型所见，不阻止执行）。

`tool_visibility` 工具自身永远不可隐藏（否则会失去控制权）。

## 表面（Surface）

- **浏览器设置页**：Settings → 工具注入控制。列出全部工具（可见 ∪ 已隐藏，隐藏的也能恢复），
  复选框逐工具开关；按名称前缀分组、支持搜索与整组批量开关；顶部有 刷新 / 全部恢复；
  显示状态文件路径与当前生效的过滤机制。
  Client↔Host 走 Connection RPC 通道 `/tool-visibility`（endpoints: `list` / `set` / `set-group` / `reset`）。
  > 兼容性：`connection.rpc.handle()` 是框架内部通道实现，第三方插件调用时它会用**通道服务自身的
  > ctx** 解析 `webServer`：在 dsh ≥ 0.1.5-rc.1（cordis 4.0.2）上直接抛
  > `cannot get property "webServer" without inject`（旧版本只静默取到 undefined，所以通道一直缺失）。
  > 因此本插件在同时注入 `webServer` + `connection` 的上下文里自行注册 `/tool-visibility`
  > 前缀路由，复用 `connection.requestRejection()` 的 Host/Origin + 浏览器会话校验；
  > 报文仍是标准 Connection RPC 信封（`client-request` / `server-response`），client 半区无需改动。
- **模型工具** `tool_visibility`：`list` / `hide` / `show` / `reset`。

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

`descriptions` 是隐藏工具的描述缓存（供 UI 显示），可配置覆盖路径：

```yaml
- id: tool-visibility
  name: '@rayfalling/dsh-tool-visibility'
  config:
    stateFile: 'F:/my/state.json'
```

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
