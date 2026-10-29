# 探测报告（A 段）— 已全部完成

执行方式：`node scripts/probe/*.mjs`，导入 dsh 已构建库（vendor/cordis、core/system-prompt、core/tools、core/scope、core/agent）。

## 结果

| # | 探测项 | 结论 | 证据 |
|---|---|---|---|
| 1 | restrict 层级合成语义 | **交集/累积**；同一 scope 连续 restrict 叠加，lift 只撤自己那次 | `afterDenyAlpha_s1=[beta]` → `afterDenyBeta_s1=[]` → `afterLift2_s1=[beta]` → `afterLift1_s1=[alpha,beta]` |
| 2 | 子 scope 能否约束上层注册的工具 | **能**（全局注册的工具可被 agent scope deny） | `afterDenyAlpha_s1=[beta]` vs `afterDenyAlpha_s2=[alpha,beta]` |
| 3 | 全局 restrict | **抛错** `requires a scoped context` | `globalRestrict: throws` |
| 4 | dispose + 重装 | **同 tick 生效** | `afterLift1_s1` 立即含 alpha |
| 5 | scopeOf 区分会话 | **是**，两个 scope key 不同且非 undefined | `scopeDistinct: true` |
| 6 | 安装时机能否影响同一轮 | **能**，同 tick 的 `schemas()` 即反映 | 同 #4 |
| 7 | 不可约束成员 | **scope-local 注册的工具不可被 restrict**：抛 `unknown global tool` → groups-save 必须 fail-closed | `scopeLocalRestrict: throws: tools.restrict() names unknown global tool "gamma"` |
| 8 | PTC 下 tools:sdk 是否按 view 重算 | **是**：restrict 后 SDK 中成员声明消失，lift 后恢复 | `ptcBefore.sdkHasAlpha=true` → `ptcAfterRestrict.sdkHasAlpha=false` → `ptcAfterLift=true` |
| 9 | 根层 waterfall 剥离 schema | **可剥离 wire**（native 模式），但无法改变 `tools.schemas()` | `nativeAfterWaterfall=[gamma]`，`nativeAfterDispose=[alpha,gamma]` |
| 10 | preset/scope 的固定 order 段能否读 assemble context.scope | **能** | `sectionText: "SCOPED:true"`（与 scopeOf(agent ctx) 同值） |
| 2b | `ctx.agents.list()` | **可用**（空 harness 返回 `[]`） | `agentsList: 0` |

## 对计划的结论

- 主方案成立：per-agent `restrict` 可隐藏上层注册的组成员；PTC SDK 会随 view 重算（Plan B 不需要）。
- 根层无法满足 AC3（`tools.schemas()` 不变），仅能做 wire 兜底 → 验收范围仍按 `docs/decision-mount.md` 限定 agent preset 挂载。
- 任何 scope-local 注册的成员都不可约束 → 保存分组时 fail-closed，拒绝并列出名单。
