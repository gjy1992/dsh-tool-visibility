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
  复选框逐工具开关；顶部有 刷新 / 全部恢复；显示状态文件路径与当前生效的过滤机制。
  Client↔Host 走 Connection RPC 通道 `/tool-visibility`（endpoints: `list` / `set` / `reset`）。
- **模型工具** `tool_visibility`：`list` / `hide` / `show` / `reset`。

## 安装 / 挂载

作为 agent preset 的一行（推荐，获得 per-scope 过滤 + 设置页 UI）：

```yaml
# 在 <preset>/agent.cordis.yml 中追加（需先 npm 安装或从 Store 安装本包）
- id: tool-visibility
  name: 'dsh-tool-visibility'
```

Client 半区由 web 端 `dsh.client` 表自动发现（`package.json` 的 `dsh.client` 字段 +
`./client` 出口），`npm run bundle`（tsdown）产出可加载的 client bundle。

## 持久化

默认 `$DSH_HOME/tool-visibility.json`（`~/.dsh/tool-visibility.json`），每次
`hide/show/reset` 后写盘，启动时加载。格式：

```json
{ "hidden": ["import_claude", "store_search"], "descriptions": { "import_claude": "…" } }
```

`descriptions` 是隐藏工具的描述缓存（供 UI 显示），可配置覆盖路径：

```yaml
- id: tool-visibility
  name: 'dsh-tool-visibility'
  config:
    stateFile: 'F:/my/state.json'
```

## 动态版说明（测试用）

仓库里早期的「动态 Cordis 插件」（`cordis_define`/`cordis_run` 定义、进程内生效）是
**测试/原型**手段：重启即失、沙箱摸不到 `tools.restrict`。正式使用与发布一律用本静态包。

## 开发 / 发布

标准 cordis 插件包（ESM，命名导出 `name` / `inject` / `Config` / `apply`；client 半区
`src/client.js` + `dsh.client` 字段；组合包 manifest `dsh.bundle` + `cordis.patch.yml`）。

### 发布到 npm（官方流程，见 [deepseek-harness/docs/user/develop/basic/publish.zh.md](https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/develop/basic/publish.zh.md)）

1. **登录 npm**（本机当前未登录）：
   ```sh
   npm login        # 或 npm adduser；需要 npm 账号与 2FA
   npm whoami       # 确认登录成功
   ```
2. **构建 client bundle**（Web 半区需按 dsh 构建管线产出 `lib/client.js`；
   独立 `npm run bundle` 是起点，`__ModuleLoader__` 格式需 harness 仓库工具链验证）：
   ```sh
   npm run bundle
   ```
3. **打包校验**：`npm pack --dry-run` 检查 `files` 包含 `src/`、`lib/`、`cordis.patch.yml`。
4. **发布**：
   ```sh
   npm publish --access public
   ```
5. **安装验证**（本地 profile）：
   ```sh
   dsh plugin --profile <name> add dsh-tool-visibility
   dsh --profile <name> --dump-config   # 应看到 "# == dsh-tool-visibility" 层
   ```
   注：`dsh.bundle` patch 把行插到**根组合**（host 层），`restrict` 不可用会自动降级
   waterfall；要完整 per-scope 语义，把行加入 **agent preset 副本**。

### 分发到 DSH 插件市场

向 [DshMarketPlace/dsh-plugins-store](https://github.com/DshMarketPlace/dsh-plugins-store)
（API: `api.dshmk.com`）提交 GitHub 仓库，等待实机验证。仓库已带 topics：
`dsh` / `deepseek-harness` / `cordis` / `plugin` / `dsh-plugin`。

### GitHub

仓库：<https://github.com/rayfalling/dsh-tool-visibility>（public，含 topics）。

## License

MIT
