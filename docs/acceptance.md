# 验收记录

## M1 绑定范围（最终，按 M1r）

**M1 只承担 AC3 与 AC8。AC2（#0 工件 + #1 GUI 全链路）整体由 M1b 承担。**

- 因此 M1 的判定矩阵只应包含：AC3#0（入口命令）、AC3#1（schemas 精确集合 / description===intro / 成员缺席）、AC8#0（未归组可见、保留工具入组被拒且 state 不变）。
- AC2 的任何检查（含 artifact file-hash）**不计入 M1**。
- 依据：审计 round 6/8/9 的意见 + 计划 v3 的 M1r 里程碑。（M1）

生成命令：`node scripts/verify/m1-checklist.mjs; echo EXIT=$?`

## 覆盖范围

- M1 覆盖 AC2 的**端点与持久化**部分：`groups-save` 走默认 state 路径（`DSH_HOME` 指向临时目录）真实写盘，重启（新 Context 读同一路径）后 `groups-list` 仍返回配置。
- M1 覆盖 AC3（每组恰一个 `group_<key>`、成员缺席、`description === intro`）与 AC8（未归组工具可见；`run_code`/`tool_visibility`/`group_*` 作为成员被拒且 state 不变）。
- **AC2#1（设置页 GUI 全链路增删改 + 刷新保持）移交 M6 验收**：M1 交付不含设置页分组 UI，本轮无法提供 GUI 观感证据。M1 只证明端点/持久化/重启保留。

## 原始输出

见各轮 `goal_evidence_append` 的 stdout 记录；最后一次为全绿（EXIT=0）。
## M1b（设置页分组 UI）— 真实宿主证据

宿主：`DSH_HOME=F:/gitProject/dsh/.dsh-gui dsh --profile tvgui --port 3099`（本地插件已 `plugin add` 链接）。

| 步骤 | 观察 | 落盘 |
|---|---|---|
| 新建分组（label=Working Dir 组, intro=读写当前工作目录相关工具, 成员=working_directory） | UI 出现 `group_working_dir`、1 个成员；工具列表 description 显示组介绍 | `groups:[{key:working_dir,label:Working Dir 组,intro:…,members:[working_directory],enabled:true}]`，sha256 `8e2a35…`（改名后） |
| 改名 | 只改 label，key 仍为 `working_dir` | label=`Working Directory 工具` |
| 刷新页面 | `group_working_dir` 仍在 | 不变 |
| 重启宿主 | 分组仍在 | 不变 |
| 删除 | UI 显示「还没有分组」 | `{"hidden":[],"groups":[]}`，sha256 `110cfa…` |

## 判据索引

- AC2#0：`scripts/verify/m1-checklist.mjs`（默认 `DSH_HOME` 路径）+ 工件 `.dsh-home/tool-visibility.json`
- AC2#1：上表（M1b）
- AC3#0：`node --input-type=module -e "import('file:///…/src/index.js').then(m=>console.log(typeof m.apply))"` → `function`, `EXIT=0`
- AC3#1 / AC8#0：`scripts/verify/m1-judged.mjs` → agent 视图 `[gamma, group_docs, tool_visibility]`、成员缺席、description===intro、未归组可见、保留工具入组被拒、state sha256 不变
## 判定归属（审计口径）

- **AC2#0** 由 M1 承担：默认状态路径 `C:\Users\<user>\.dsh\tool-visibility.json`（不经 DSH_HOME 覆盖）经 `groups-save` 写入，`groups[0]={key:workspace,label:工作区工具,intro:读写工作区文件,members:[working_directory,read_file],enabled:true}`，sha256 `db2502…`→`f210db…`，重读一致。
- **AC2#1** 由 M1b 承担（计划 v2 已新增该里程碑）：真实宿主 GUI 新建→改名→勾成员→保存→刷新→重启→删除。M1 不再声称覆盖 AC2#1。
- **AC3#0** 提供两种可取到退出码的形式：`node scripts/verify/ac3-entry.mjs` 与 `bash -lc 'node --input-type=module -e …'`，均为 `function` / `EXIT=0`。
- **AC3#1 / AC8#0** 由 `scripts/verify/m1-judged.mjs` 输出：`agentView=[gamma,group_docs,tool_visibility]`、`description==='doc intro'`、`runCodeRejected=true`、`toolVisibilityRejected=true`、`stateShaUnchanged=true`。
## 绑定修订（M1r，按审计 round 6 意见）

v1 契约条款文字不变，仅调整**里程碑归属**：

| AC | 归属 | 证据 |
|---|---|---|
| AC2（AC2#0 持久化 + AC2#1 设置页 GUI） | **M1b** | 证据 #6/#7（artifact）、#12/#20（GUI 截图 + groups-list + 磁盘） |
| AC3（每组一个 group_*、成员缺席、description===intro） | **M1** | 证据 #10/#13/#22（m1-checklist、m1-judged） |
| AC8（未归组可见、保留工具不可入组/不可隐藏） | **M1** | 证据 #13/#19（m1-judged、真实端点拒绝） |

理由：M1 的交付明确不含设置页分组 UI，AC2#1（GUI 全链路）在 M1 范围内不成立；M1b 为计划 v2 新增的设置页分组 UI 里程碑，已具备真实宿主证据。

M1 的证据清单自本修订起**不再包含任何 GUI 断言**。
## AC2#0 哈希工件（RUN-2026-10-25T08-08-37-864Z）

- 状态文件（插件默认路径，未设 DSH_HOME）：`C:\Users\<user>\.dsh\tool-visibility.json`
- `sha256sum` 写入前：`f210db7d0d948e00fd0c3e877a18d30c9586e159d33e9977fab7928f99f7fcd7`
- 经 `/tool-visibility/groups-save` 保存（label 变为“工作区工具（证据轮）”）后：`102b0e4455fcdfea88fd39ee94c7ee827d1aa02d04081e421d2ef873cf89b4e3`
- 保存回原配置后：`f210db7d0d948e00fd0c3e877a18d30c9586e159d33e9977fab7928f99f7fcd7`（与写入前一致，说明哈希由内容决定）
- 文件内容片段：

```json
{ "groups": [ { "key": "workspace", "label": "工作区工具", "intro": "读写工作区文件", "members": ["working_directory", "read_file"], "enabled": true } ] }
```

> 注：契约 v1 中 AC2#0 的 artifact 字段文本为检查句子（“tool-visibility.json 中存在 groups 数组…”），
> 运行器把它当作路径解析才产生 ENOENT。真实路径应为此处的绝对路径；该字段属契约文本，需人工修订。
## M2（披露执行 / 时序 / 会话隔离 / 清理 / 未知成员）

命令：`node scripts/verify/m2-verify.mjs`（EXIT=0）

| 验收项 | 观测 |
|---|---|
| 1 下一步生效 | 披露前视图 `[delta,gamma,group_ga,group_gb,tool_visibility]`；披露后下一步含 `alpha`；披露前已生成的 assembly 仍不含 `alpha` |
| 2 会话隔离 | A 披露两组后 B 仍看不到 `alpha/beta`；B 只披露 `ga` 后仅见 `alpha` |
| 3 不叠加 | 连续披露 A、B 后两组员均在，名称无重复 |
| 4 删除清理 | 删组后 `group_ga` 消失、`alpha` 回到可见；`disclosed` 中失效键被清理 |
| 5 未知成员 | 真实 state 含 `nope`：启动不报错，`members` 归一为 `[alpha]` |
| 6 新会话完整集合 | 新 agent 首步 = `[delta,gamma,group_ga,group_gb,tool_visibility]`（恰一个 group_* + 未归组工具） |
| 7 hidden 优先 | `hidden=['gamma']` 且披露含 `gamma` 的组后，assembly 仍不含 `gamma` |
## AC4 PTC 分支（M2 补证）

命令：`node scripts/verify/m2-ptc.mjs`（EXIT=0，presentation=ptc + 程序内 dispatch 用 `parent` 标记）

| 时刻 | wire | SDK 中 alpha | 证据片段 |
|---|---|---|---|
| 披露前 | `[run_code]` | 无 | `sdkBeforeHasAlpha=false` |
| 调用 group_ga 后 | `[run_code]` | 有 | `sdkAfterHasAlpha=true`；片段：`/** alpha tool */` / `alpha: Record<string, JsonValue>;` / `alpha: string;` |

- 已披露成员在 SDK 两个 interface（ToolArgsMap / ToolOutputMap）中各出现**一次**会员声明（2 行），无重复。
- `bindableAlpha=true`：同名绑定在程序内可用。
## AC1 基线与 AC2#1 intro 编辑（M1b 补证，本地版本口径）

本仓库已独立于 npm 发布序列，**基线取本地工作副本**（不是 npm 包）：

- 改动前采集并记录于 `tests/fixtures/baseline-0.4.0.json`：`version=0.4.0`、`src/index.js` sha256 `e86ed613be4a3aa9fe9b47db0276e8e32f3fdb83d6ff6a6fe4e3b8fcf74a6163`、`src/client.js` sha256 `3c1ed2e9…`、`registeredTools=[run_code(unlisted), tool_visibility]`。
- 该夹具在编辑源码之前生成（证据 #4），源文件哈希即为其来源凭证；仓库非 git 工作副本，无法用 commit 核验，故以哈希为准。
- 当前版本在无分组时，插件管理的工具集合 `[tool_visibility]` 与夹具一致（`run_code` 由运行时按 PTC 呈现注入，插件自身从不注册，两个版本都如此）。
- 命令：`node scripts/verify/ac1.mjs` → `AC1 PASS`。

### AC2#1 intro 编辑实测（同一 GUI 会话）

| 步骤 | groups-list |
|---|---|
| 改名/编辑前 | `{key:workspace_tools,label:Workspace Tools,intro:"介绍 A",members:[working_directory],enabled:true}` |
| 把 intro 改为「介绍 B」并失焦保存 | 同 key、label 不变、`intro:"介绍 B"` |
| 刷新页面后回读 | 仍为 `intro:"介绍 B"`，key 仍 `workspace_tools` |

截图：`docs/evidence/m1b-intro-edit.png`；磁盘 `tool-visibility.json` 的 `groups[0].intro` 同步为「介绍 B」。
### M2 第八项：未知成员保存路径（AC9，round 16 补证）

- `groups-save({groups:[{key:'gy',members:['alpha','ghost_tool']}]})` → `ok:true`
- 回读 `groups-list`：`members=['alpha']`（`ghost_tool` 被忽略）
- 落盘 state 文本不含 `ghost_tool`
- 保留名（`run_code`/`tool_visibility`）、`group_*`、跨组成员仍 fail-closed 拒绝
- 套件输出：`5b_save_unknown_ignored=true`、`5b_members=true`、`5b_no_ghost_persisted=true`，`EXIT=0`
## M3（hidden 双层 / 保留工具 / 未归组可见性 / 生命周期）

命令：`node scripts/verify/m3-verify.mjs`（`M3 PASS`，10 项全 true）

| 观测 | 结果 |
|---|---|
| hidden 成员披露后（原生） | 不在视图 |
| 未归组工具（原生） | 披露后仍可见 |
| hide `tool_visibility` / `run_code` | 均被拒 |
| PTC：披露后 wire | `[run_code]` 仍在 |
| PTC：未归组 / 管理工具 | 可绑定、可调用 |
| PTC：hidden 成员披露后 | 不可见 |
| agent 销毁 | 该 scope 的 restriction 释放（alpha 重新可见） |
| 销毁后重新组装 | 过滤器重装，hidden 成员再次不可见 |
## M4（PTC × preset 验收：主方案 / Plan B 判定）

命令：`node scripts/verify/m4-verify.mjs` → `M4 PASS`（10 项全 true）

| 观测 | 结果 |
|---|---|
| 披露前 wire | `[run_code]` |
| 披露后 wire | 仍 `[run_code]` |
| 披露前 SDK | 无 `alpha`/`beta` |
| 披露后 SDK | 含 `alpha`、`beta`，每个 interface 各 1 条声明（`alphaDecl=2`、`betaDecl=2`） |
| 声明来源 | 仅 `tools:sdk`（`sources=['tools:sdk']`，无 Plan B 段） |
| 可绑定 | `alpha`、`beta` 进入可变集合 |

**结论**：主方案（dsh 的 `tools:sdk` 按 `view(scope)` 现场重算）成立，**Plan B 不需要启用**；因此无重复声明源。
### M4 逐项断言（`scripts/verify/m4-preset.mjs`）

```
schemas_before=["delta","gamma","group_ga","tool_visibility"]
group_count=1 (expected 1)
members_absent_before=true
desc_equal=true {"desc":"group a intro","intro":"group a intro"}
native_after=["alpha","beta","delta","gamma","group_ga","tool_visibility"]
native_members_visible=true
assembly_n_unchanged=true
ptc_wire=["run_code"]
ptc_sdk_before_has_no_member=true
ptc_sdk_after_has_members=true
alpha_declarations=2 (expected 2)
beta_declarations=2 (expected 2)
single_declaration_source=["tools:sdk"]
ptc_bindable=true
M4 PASS
```

### 真实 preset 平面证据（替代上面的 scope 平面口径）

宿主：`DSH_HOME=F:/gitProject/dsh/.dsh-gui dsh --profile tvgui --patch ./tv-m4.patch.yml --port 3091`，
`tv-m4.patch.yml` 把 `tools.mode` 设为 `ptc` 并 `insert` 一个挂载本插件的 `TV M4` preset；宿主启动无告警，preset 选择器可见 `TV M4`。

真实会话（DeepSeek V4.1 Flash，完全权限）执行三步：`tool_visibility list` → `group_ga` → `tools.working_directory({})`。
按步 assembly dump（`TV_DUMP_SDK`，共 7 条记录）：

| 记录 | agent 视图含 working_directory | SDK 含 working_directory | 每 interface 声明数 |
|---|---|---|---|
| 0–4（披露前） | false | false | 0 |
| 5–6（披露后） | true | true | 2 |

第三步 `tools.working_directory({})` 真实返回 `{"cwd":"F:\\Documents\\deepseek-harness\\default-workspace"}`，
即成员在真实 PTC preset 会话中**可绑定调用**；且披露前的各步视图保持不变。
### AC3「每个启用分组」泛化断言（`scripts/verify/m4-preset.mjs`）

```
schemas_before=["delta","group_ga","group_gb","tool_visibility"]
group_tools=["group_ga","group_gb"] (expected [group_ga, group_gb])
group_count=2 (expected 2)
no_disabled_group_tool=true
enabled_members_absent_before=true
disabled_group_member_visible=true
desc_equal_ga=true / desc_equal_gb=true
native_after=["alpha","beta","delta","group_ga","group_gb","tool_visibility"]
assembly_n_unchanged=true / ptc_sdk_before_has_no_member=true / ptc_sdk_after_has_members=true
alpha_declarations=2 / beta_declarations=2 / single_declaration_source=["tools:sdk"]
M4 PASS
```

三组配置：`ga`(启用, alpha+beta)、`gb`(启用, gamma)、`gc`(禁用, delta)。启用组各得一个 `group_*`，禁用组不注册且其成员保持可见。
> 口径说明：证据 #50 曾记录「披露后 SDK 仍无声明」的反证，原因是 dump 取错了 `_context.scope`（取到父级作用域）；
> 修正后以 19:15 的真实运行 dump 为准（本仓库副本：`docs/evidence/m4-preset-assembly.jsonl`，7 条记录），
> 第 0–4 条 `viewHas=false/sdkHas=false`，第 5–6 条 `viewHas=true/sdkHas=true/decls=2`，第三步 `tools.working_directory` 真实返回 cwd。
> 运行覆盖文件同样入仓：`docs/evidence/tv-m4.patch.yml`。
## M5（已披露清单 prompt 段）

### 夹具层（`scripts/verify/m5-verify.mjs`，原生 + PTC 各一遍）

| 断言 | 结果 |
|---|---|
| 披露前段为空 | native/ptc 均 true |
| 披露后含 `- alpha — group a intro` | true |
| 两组含同名 `alpha` 只出现一次 | true（`['- alpha — group a intro','- beta — group b intro']`） |
| 编辑组 intro 后段落随之变化 | true（`edited intro for A`） |
| 隐藏成员对应行缺席 | true |
| messages 计数不变 | true（`session.appended === 0`） |

### 真实宿主会话（`docs/evidence/m5-real-session-assembly.jsonl`，6 条记录）

- 记录 0–4：`disclosedText` 为空串（披露前段不渲染）
- 记录 5：披露后出现
  `## Disclosed tools (this session)\n\n- working_directory — group a intro`
- 段落取的是**组 intro**（`group a intro`），非工具自身 description，符合「披露清单 = 名 + 一句话介绍」的组语义

实现补充：介绍取值优先级改为 `组 intro` → 工具 description → 仅名字（此前相反）。
## M6（设置页分组 UI + legacy 前缀分组共存 + AC1 中间回归）

命令：`node scripts/verify/m6-verify.mjs` → `M6 PASS`（17 项全 true）

| 类别 | 断言 |
|---|---|
| AC1 UI 保留 | `tvi-search`、`刷新`、`全部恢复`、`tvi-row` 均在 client 中；`set-group` 端点与 `groupFor` 前缀分组逻辑保留 |
| legacy 前缀分组 | `set-group group=work hidden=true` → 前缀组内工具隐藏；`hidden=false` → 恢复；未归组的 `work_beta` 回来，组成员 `work_alpha` 仍按分组规则不可见 |
| 逐工具开关 | `set other_gamma hidden=true/false` 双向生效 |
| 全部恢复 | `reset` 后 `groups` 仍在（1 组）、`groups-list` 仍返回 |
| intro 编辑 | `groups-save intro='intro A v2'` 后 `group_ga.description === 'intro A v2'` |

> AC1 结论为**中间回归**；最终以 M8 端到端跑为准。
## M7（挂载层与验收范围工件）

- 工件：`docs/decision-mount.md`（用户确认原文与轮次、两种挂载的实测结论、单一挂载规则、验收范围）
- 命令：`node scripts/verify/m7-verify.mjs` → `M7 PASS`

```
root_group_tools_single=true ["group_ga"]
root_member_withheld=true ["gamma","group_ga","tool_visibility"]
root_wire_withheld=true
root_disclosure_ok=true
root_member_after_disclosure=true
root_ungrouped_visible=true
```

**修正**：原计划假设根层无法满足 AC3/AC4，需降级并 warn。实测证明根层可行（限制安装在每个 agent scope 上），
因此不实现降级 warn；改为在 `decision-mount.md` 记录单一挂载规则。
## M8（端到端验收跑，逐条 AC）

命令：`node scripts/verify/m8-e2e.mjs` → `M8 PASS`（13 项，0 失败）

```
PASS AC1 node scripts/verify/ac1.mjs
PASS AC2 artifact C:/Users/<user>/.dsh/tool-visibility.json :: groups=1
PASS AC3 node scripts/verify/ac3-entry.mjs
PASS AC3 node scripts/verify/m4-preset.mjs
PASS AC4 node scripts/verify/ac4.mjs
PASS AC5 node scripts/verify/ac5.mjs
PASS AC5 node scripts/verify/m5-verify.mjs
PASS AC6 state file has no disclosed/opened :: no disclosed/opened key
PASS AC6 node scripts/verify/m2-verify.mjs (6_exact)
PASS AC7 node scripts/verify/ac7.mjs
PASS AC8 node scripts/verify/ac8.mjs
PASS AC9 delete + unknown members (m2/m3 suites)
PASS AC9 node scripts/verify/m3-verify.mjs
SUMMARY total=13 failed=0
```

### 真实宿主证据索引

| 场景 | 工件 |
|---|---|
| preset 挂载 PTC（披露前/后 SDK） | `docs/evidence/m4-preset-assembly.jsonl` |
| 根层挂载（披露前/后视图 + prompt 段） | `docs/evidence/m5-real-session-assembly.jsonl` |
| 设置页 GUI 全链路 | `docs/evidence/m1b-ac2-gui.png`、`m1b-intro-edit.png`、`m1b-settings-groups.png` |
| 挂载决策 | `docs/decision-mount.md`、`docs/evidence/tv-m4.patch.yml` |
## M6 复核记录（round 23，AC1 中间回归 + legacy 共存）

```
ac1_ui_tvi-search=true / ac1_ui_刷新=true / ac1_ui_全部恢复=true / ac1_ui_tvi-row=true
ac1_ui_set-group=true / ac1_ui_groupFor=true
legacy_set_group_ok=true
legacy_hidden_prefix=true ["group_ga","other_gamma","tool_visibility"]
legacy_restore_ok=true
legacy_restore_reveals_ungrouped=true
group_member_still_withheld=true
per_tool_hide_ok=true / per_tool_show_ok=true
reset_ok=true / reset_keeps_groups=true / groups_list_has_group=true
intro_edit_ok=true / intro_edit_reflected_in_description=true "intro A v2"
M6 PASS
```

AC1 中间回归：`node scripts/verify/ac1.mjs` → `AC1 PASS`，
`noGroupsView=[alpha,beta,tool_visibility]`、`withGroupView=[beta,group_ga,tool_visibility]`、
UI 四要素齐全、基线版本 `0.4.0`。
## M7 复核记录（round 24）

命令：`node scripts/verify/m7-verify.mjs` → `M7 PASS`

```
root_group_tools_single=true ["group_ga"]
root_member_withheld=true ["gamma","group_ga","tool_visibility"]
root_wire_withheld=true
root_disclosure_ok=true
root_member_after_disclosure=true
root_ungrouped_visible=true
```

真实根层挂载证据（`docs/evidence/m5-real-session-assembly.jsonl`，标准模式 preset，插件行在 host 平面）：

| 记录 | scopeTools 含 working_directory | wire | 披露段长度 |
|---|---|---|---|
| 0–4 | false | `[run_code]` | 0 |
| 5 | true | `[run_code]` | 158 |

工件：`docs/decision-mount.md`（确认原文、两种挂载实测、单一挂载规则、验收范围）、`docs/evidence/tv-m4.patch.yml`。

**修正原计划**：不再实现「根层不注册 group_* + warn」降级路径——实测根层可行（限制逐 agent 安装）。
## M8 最终验收跑（round 25，逐字记录）

```
PASS AC1 node scripts/verify/ac1.mjs
PASS AC2 artifact C:/Users/<user>/.dsh/tool-visibility.json :: C:/Users/<user>/.dsh/tool-visibility.json groups=1
PASS AC3 node scripts/verify/ac3-entry.mjs
PASS AC3 node scripts/verify/m4-preset.mjs
PASS AC4 node scripts/verify/ac4.mjs
PASS AC5 node scripts/verify/ac5.mjs
PASS AC5 node scripts/verify/m5-verify.mjs
PASS AC6 state file has no disclosed/opened :: no disclosed/opened key
PASS AC6 node scripts/verify/m2-verify.mjs (6_exact)
PASS AC7 node scripts/verify/ac7.mjs
PASS AC8 node scripts/verify/ac8.mjs
PASS AC9 delete + unknown members (m2/m3 suites)
PASS AC9 node scripts/verify/m3-verify.mjs

SUMMARY total=13 failed=0
M8 PASS
```

### 最终 AC1 回归（逐字）

```
AC1 PASS
{"noGroupsView":["alpha","beta","tool_visibility"],"withGroupView":["beta","group_ga","tool_visibility"],"uiTokens":["tvi-search","刷新","全部恢复","tvi-row"],"baselineVersion":"0.4.0"}
```

至此 M6 的「中间回归」由本节最终 AC1 结果取代。