# 挂载层决策与验收范围（M7）

## 用户确认原文与轮次

- 「AC3/AC4 只在 agent preset 挂载验收」——本会话 PLAN 阶段，用户在挂载范围问题中确认；
  随后选择「确认范围，但还要再评一轮」。
- 后续实测（M7）推翻了「根层不能工作」的前提：见下节。

## 实测结论：两种挂载都成立

| 挂载 | 证据 | 结果 |
|---|---|---|
| agent preset（`TV M4` preset，`tools.mode=ptc`） | `docs/evidence/m4-preset-assembly.jsonl` | 披露前视图/SDK 无成员；披露后含成员且每 interface 各 1 条声明 |
| 根层 bundle（标准模式，插件行在 host 平面） | `docs/evidence/m5-real-session-assembly.jsonl` | 记录 0–4 成员被隐藏、记录 5 披露后出现；prompt 段同步 |
| 根层夹具 | `scripts/verify/m7-verify.mjs` → `M7 PASS` | `group_ga` 唯一注册、成员隐藏、披露后出现、未归组工具可见 |

原因：`tools.restrict` 需要 **agent scope**，而本插件从 `agents` 注册表取每个 agent 的 `ctx` 安装限制，
因此插件行落在根层也能约束每个 agent 的视图；`system-prompt/assemble` 的 disclosure 段按 `context.scope` 读取同一份状态。

## 单一挂载规则

- 分组只应由**一行**启用：要么根层 bundle 行，要么某个 preset 行，不要两处同时挂载。
- 同时挂载会导致 `group_<key>` 重复注册（`tools.register` 会抛 `already registered`），插件不会静默去重。
- 推荐：agent preset 行（`--patch` 或 preset 声明），配置文件见 `docs/evidence/tv-m4.patch.yml`。

## 验收范围

- AC3/AC4 的判定以 **preset 挂载**（M4 证据）为准；根层挂载另有等价证据（M5/M7），作为补充而非替代。