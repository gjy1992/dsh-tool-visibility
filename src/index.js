/**
 * dsh-tool-visibility
 *
 * Control which tool schemas are injected into the DeepSeek Harness model
 * context, with a settings-page UI and a model-facing manager tool.
 *
 * Mechanism (framework-native first):
 *  1. `ctx.tools.restrict({ deny })` — the ToolRuntime's per-scope visibility
 *     filter. Mounted as an agent-preset row, the restriction is registered in
 *     the preset scope and hides the named tools for every agent under it:
 *     the schemas leave the model context AND calls to them resolve as
 *     `UNKNOWN_TOOL`. This is the designed control point.
 *  2. Fallback `system-prompt/assemble` waterfall listener — only used when
 *     `restrict` is unavailable (e.g. an unscoped host mount). It strips the
 *     hidden schemas from the assembled prompt so the model stops seeing them.
 *
 * Surface:
 *  - model tool `tool_visibility` (list / hide / show / reset);
 *  - browser settings page (Settings → 工具注入控制) talking to the
 *    `/tool-visibility` Connection RPC channel (list / set / set-group / reset),
 *    grouped by raw tool-name prefix, with search and whole-group toggles.
 *
 * Reserved tools: `tool_visibility` (this manager) and `run_code` (the PTC
 * presentation transport the runtime inserts into `tools.schemas()` for any
 * scope that presents code — `tools.register` refuses the name and
 * `tools.restrict` throws on it) can never be hidden, and `run_code` is not
 * listed at all — it is runtime plumbing, not a manageable tool. Stripping
 * `run_code` would leave a PTC agent with no way to call anything at all.
 *
 * Dependency policy: this host entry performs NO static `@deepseek-ai/*`
 * imports. The runtime provides everything through injected services
 * (`ctx.tools`, `ctx.systemPrompt`, `ctx.connection`), so the package loads in
 * any profile where the dsh runtime itself runs — third-party bundles cannot
 * rely on `@deepseek-ai/*` resolving from the profile's node_modules (built-ins
 * resolve only from the dsh install). `@deepseek-ai/dsh-scope` is loaded
 * dynamically as an optional upgrade for scope-aware tool views and degrades
 * to the global registry view when absent.
 *
 * Persistence: the hidden set (plus a description cache for hidden tools) is
 * loaded on start and written on every change to `$DSH_HOME/tool-visibility.json`
 * (override with the `stateFile` config).
 */
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const name = 'dsh-tool-visibility';

export const inject = ['tools'];

const MANAGER_TOOL = 'tool_visibility';
/** Reserved PTC presentation transport the runtime injects for code-presenting scopes. */
const PTC_TRANSPORT_TOOL = 'run_code';
const RPC_CHANNEL = '/tool-visibility';

/**
 * Tools that can never join the hidden set.
 *
 *  - `tool_visibility` — this manager; hiding it removes the control surface.
 *  - `run_code` — the reserved PTC presentation transport (also unlisted). The runtime injects
 *    it into `tools.schemas()` for every scope that presents code, while
 *    `tools.register()` refuses the name and `tools.restrict({ deny })` throws
 *    when it is named (dsh >= 0.1.7-rc.1). A hidden entry would therefore either
 *    abort the whole registry restriction or, through the waterfall, strip the
 *    one channel a PTC agent calls tools through.
 */
const RESERVED_TOOLS = new Set([MANAGER_TOOL, PTC_TRANSPORT_TOOL]);

/**
 * Reserved names that are runtime plumbing rather than manageable tools, and so
 * never appear in the settings page or the manager tool's listing. `run_code`
 * is injected by the runtime for every scope that presents code; it is not a
 * tool anyone can meaningfully switch off, and showing it as a disabled row
 * only invites the misconception that it is a peer of the user's tools.
 */
const UNLISTED_TOOLS = new Set([PTC_TRANSPORT_TOOL]);
/**
 * Tool-name prefix of one group's disclosure tool (group_<key>). A group's
 * intro is carried verbatim as this tool's description, so the model sees the
 * group introduction before any member is disclosed.
 */
const GROUP_TOOL_PREFIX = 'group_';

/** Group key grammar: lowercase identifier, stable after creation. */
const GROUP_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

/** Names that may never join a group's member list. */
const FORBIDDEN_MEMBERS = new Set([...RESERVED_TOOLS]);

/** True when a name is a disclosure tool (this plugin's own namespace). */
function isGroupToolName(name) {
  return typeof name === 'string' && name.startsWith(GROUP_TOOL_PREFIX);
}

/** The disclosure tool name of one group key. */
function groupToolName(key) {
  return GROUP_TOOL_PREFIX + key;
}

/**
 * Names quoted by a `tools.restrict()` rejection: dsh reports every rejected
 * name at once and pluralizes the phrase once more than one is unknown
 * (`names unknown global tool "a"` / `names unknown global tools "a", "b"`), so
 * both forms must be parsed — a singular-only match treated the plural error as
 * an unknown failure and abandoned the whole restriction.
 */
function unrestrictableNames(message) {
  const head = /^tools\.restrict\(\) names unknown global tools? (.*?)(?:;\s*known global tools:|$)/.exec(message);
  if (head === null) return [];
  return [...head[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/** Default state file: $DSH_HOME/tool-visibility.json (fallback ~/.dsh/...). */
function defaultStateFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'tool-visibility.json');
}

/** RpcResult success/error helpers (dsh-host-apiproxy shape). */
const rpcOk = (value) => ({ ok: true, value });
const rpcErr = (code, message) => ({ ok: false, error: { code, message, details: {} } });

/** Group key = raw name prefix (token before the first '_', else the name). */
function groupFor(name) {
  const i = name.indexOf('_');
  return i === -1 ? name : name.slice(0, i);
}

export async function apply(ctx, config = {}) {
  if (config && config.enabled === false) return;

  const systemPrompt = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : undefined;
  const stateFile = (config && typeof config.stateFile === 'string' && config.stateFile) || defaultStateFile();
  const hidden = new Set();
  const descriptions = new Map();
  let groups = [];
  /** mtime of the state file at the last successful load (external-edit hot reload). */
  let stateFileMtimeMs = 0;
  let extraState = {};
  const extraGroupFields = new Map();
  const disclosed = new Map();
  const agentFilters = new Map();
  /** Deny-set signature of the restriction currently installed per scope. */
  const agentFilterSignatures = new Map();
  /**
   * Names `tools.restrict()` rejects because they were never global: a tool a
   * plugin registered in the agent's own layer (Agent Teams registers its
   * Lead-only `spawn_teammate` / `team_task_*` per agent scope) can be neither
   * denied nor allowed by a global restriction. Learning them once keeps every
   * later reinstall (one per prompt assembly) from re-failing on them.
   */
  const unrestrictable = new Set();
  /** Names whose "left visible" warning was already printed — warn once, not per assembly. */
  const warnedUnrestrictable = new Set();
  let groupToolDisposers = [];
  let writeChain = Promise.resolve();
  let filterMode = 'none';
  let lift = null;
  /** Log a warning once one RPC round-trip (or one step inside it) exceeds this. */
  const SLOW_MS = Number(process.env.TV_SLOW_MS || 500);
  const SLOW_STEP_MS = Number(process.env.TV_SLOW_MS || 500);
  /** Debounce for the usage-statistics file: one write per burst of calls. */
  const USAGE_WRITE_DELAY_MS = 1500;
  /** Upper bound on in-flight callId→name pairs (a turn aborted mid-call must not grow it forever). */
  const PENDING_CALL_LIMIT = 2000;

  let scopeOf = null;
  if (config && typeof config.__scopeOf === 'function') {
    scopeOf = config.__scopeOf;
  } else {
      try {
      scopeOf = (await import('@deepseek-ai/dsh-scope')).scopeOf;
        } catch {
      scopeOf = null;
        }
  }
  /**
   * Stable per-agent identity for the filter/disclosure bookkeeping.
   *
   * dsh-scope's key is only readable by the exact module instance that minted it
   * (its scope symbol is module-local). A plugin loaded from another package
   * graph — e.g. the profile bundle here, which resolves the published
   * lib/ while a source-run host uses src/ — would get `undefined` for every
   * agent and silently install no filter at all. Fall back to the context object
   * itself so group restriction works regardless of that instance mismatch.
   */
  const fallbackScopeKeys = new WeakMap();
  let fallbackScopeSeq = 0;
  function scopeKeyOf(agentCtx) {
    if (agentCtx === null || typeof agentCtx !== 'object') return undefined;
    if (scopeOf) {
      try {
        const key = scopeOf(agentCtx);
        if (key !== undefined) return key;
      } catch { /* fall through to the object key */ }
    }
    let key = fallbackScopeKeys.get(agentCtx);
    if (key === undefined) {
      key = 'tv-scope-' + (++fallbackScopeSeq);
      fallbackScopeKeys.set(agentCtx, key);
    }
    return key;
  }

  const scopeFor = (exec) => {
    if (!scopeOf) return undefined;
    try {
      if (exec && exec.agent) return scopeOf(exec.agent.ctx);
      return scopeOf(ctx);
    } catch {
      return undefined;
    }
  };

  // ── persistence ────────────────────────────────────────────────────────────
  async function load() {
    let parsed;
    try {
      const info = await stat(stateFile);
      if (typeof info.mtimeMs === 'number') stateFileMtimeMs = info.mtimeMs;
      parsed = JSON.parse(await readFile(stateFile, 'utf8'));
    } catch {
      return; // Missing or corrupt state file: start empty.
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    if (Array.isArray(parsed.hidden)) {
      for (const entry of parsed.hidden) {
        // Reserved names are dropped defensively: a state file written by a
        // build that allowed them must not disable the filter (or the PTC
        // transport) on start.
        if (typeof entry === 'string' && !RESERVED_TOOLS.has(entry)) hidden.add(entry);
      }
    }
    if (parsed.descriptions && typeof parsed.descriptions === 'object' && !Array.isArray(parsed.descriptions)) {
      for (const [key, value] of Object.entries(parsed.descriptions)) {
        if (typeof value === 'string') descriptions.set(key, value);
      }
    }
    if (Array.isArray(parsed.groups)) groups = normalizeGroups(parsed.groups, true);
    // Unknown top-level keys survive our rewrite (another writer may own them).
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'hidden' || key === 'descriptions' || key === 'groups') continue;
      extraState[key] = value;
    }
  }

  /**
   * Pick up an externally edited state file (mtime moved since the last load).
   * Without this, editing $DSH_HOME/tool-visibility.json by hand would only take
   * effect after a restart, and the next in-process write would clobber it.
   * Invalid/partially written files are ignored: the current configuration stays.
   */
  async function reloadStateIfChanged(force = false) {
    let mtimeMs;
    try {
      const info = await stat(stateFile);
      mtimeMs = typeof info.mtimeMs === 'number' ? info.mtimeMs : 0;
    } catch {
      return;
    }
    // The settings page's 刷新 button forces a re-read so a hand edit is picked
    // up even when the editor preserved the timestamp.
    if (mtimeMs === 0 || (!force && mtimeMs <= stateFileMtimeMs)) return;
    let parsed;
    try {
      parsed = JSON.parse(await readFile(stateFile, 'utf8'));
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    stateFileMtimeMs = mtimeMs;
    if (Array.isArray(parsed.groups)) {
      const next = normalizeGroups(parsed.groups, true);
      if (validateGroups(next, true) === null) {
        groups = next;
        applyGroups();
        applyFilter();
      }
    }
    if (Array.isArray(parsed.hidden)) {
      hidden.clear();
      for (const entry of parsed.hidden) {
        if (typeof entry === 'string' && !RESERVED_TOOLS.has(entry)) hidden.add(entry);
      }
      applyFilter();
    }
  }

  /**
   * Atomic, serialized write. Every writer (hidden/show/reset/groups-save) goes
   * through this one path so a concurrent writer can never drop the groups
   * field, and a crash can never leave a half-written state file.
   */
  function persist() {
    const run = async () => {
      await mkdir(path.dirname(stateFile), { recursive: true });
      const state = { ...extraState, hidden: [...hidden].sort() };
      if (descriptions.size > 0) {
        state.descriptions = Object.fromEntries([...descriptions.entries()].sort());
      }
      state.groups = groups.map((group) => ({
        ...(extraGroupFields.get(group.key) ?? {}),
        key: group.key,
        label: group.label,
        intro: group.intro,
        members: [...group.members],
        enabled: group.enabled,
      }));
      const temp = stateFile + '.tmp-' + process.pid;
      await writeFile(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
      await rename(temp, stateFile);
      // Our own write is the new baseline: the next read must not treat it as
      // an external edit and re-apply the same configuration.
      try {
        const info = await stat(stateFile);
        if (typeof info.mtimeMs === 'number') stateFileMtimeMs = info.mtimeMs;
      } catch { /* best effort */ }
    };
    // Chain regardless of the previous outcome: one failed write must not wedge the queue.
    const next = writeChain.then(run, run);
    writeChain = next.catch(() => {});
    return next;
  }

  /** Like persist() but returns a warning string instead of throwing. */
  async function persistSafely() {
    try {
      await persist();
      return null;
    } catch (error) {
      return 'persist failed: ' + (error instanceof Error ? error.message : String(error));
    }
  }

  // ── tool usage statistics (cross-session, settings-page view) ──────────────
  //
  // Counts live in their own file so 全部恢复 (which rewrites the hidden set and
  // the groups) can never take the history with it, and so wiping the counts
  // (统计页的重置按钮) never touches the filter configuration.
  const usageFile = (config && typeof config.usageFile === 'string' && config.usageFile)
    || path.join(path.dirname(stateFile), 'tool-visibility-stats.json');
  /** tool name → { count, errors, firstUsedAt, lastUsedAt } */
  const usage = new Map();
  /** callId → { name, at } for calls whose result has not arrived yet. */
  const pendingCalls = new Map();
  let usageLoadedAt = 0;
  let usageTimer = null;
  let usageWriting = Promise.resolve();

  async function loadUsage() {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(usageFile, 'utf8'));
    } catch {
      return; // Missing or corrupt: start empty, never fail the plugin load.
    }
    const tools = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.tools : undefined;
    if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return;
    for (const [toolName, raw] of Object.entries(tools)) {
      if (typeof toolName !== 'string' || toolName.length === 0) continue;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const count = Number(raw.count);
      if (!Number.isFinite(count) || count < 0) continue;
      const errors = Number(raw.errors);
      usage.set(toolName, {
        count: Math.floor(count),
        errors: Number.isFinite(errors) && errors > 0 ? Math.floor(errors) : 0,
        firstUsedAt: typeof raw.firstUsedAt === 'string' ? raw.firstUsedAt : null,
        lastUsedAt: typeof raw.lastUsedAt === 'string' ? raw.lastUsedAt : null,
      });
    }
    usageLoadedAt = Date.now();
  }

  /** Serialized, atomic write of the usage file (same temp+rename shape as persist). */
  function writeUsage() {
    const run = async () => {
      await mkdir(path.dirname(usageFile), { recursive: true });
      const tools = {};
      for (const toolName of [...usage.keys()].sort()) tools[toolName] = usage.get(toolName);
      const body = { version: 1, updatedAt: new Date().toISOString(), tools };
      const temp = usageFile + '.tmp-' + process.pid;
      await writeFile(temp, JSON.stringify(body, null, 2) + '\n', 'utf8');
      await rename(temp, usageFile);
    };
    const next = usageWriting.then(run, run);
    usageWriting = next.catch(() => {});
    return next;
  }

  /**
   * Coalesce the file write: a turn that calls twenty tools must not perform
   * twenty temp-file+rename cycles. A failure is swallowed — statistics are
   * diagnostics, never a reason to break a turn.
   */
  function scheduleUsageWrite() {
    if (usageTimer !== null) return;
    usageTimer = setTimeout(() => {
      usageTimer = null;
      writeUsage().catch((error) => {
        try {
          console.warn('[' + name + '] usage stats write failed: '
            + (error instanceof Error ? error.message : String(error)));
        } catch { /* logging must never throw */ }
      });
    }, USAGE_WRITE_DELAY_MS);
    // The host process must not be held open by a pending statistics write.
    if (typeof usageTimer.unref === 'function') usageTimer.unref();
  }

  function bumpUsage(toolName, failed) {
    if (typeof toolName !== 'string' || toolName.length === 0) return;
    const now = new Date().toISOString();
    const entry = usage.get(toolName) ?? { count: 0, errors: 0, firstUsedAt: now, lastUsedAt: null };
    entry.count += 1;
    if (failed) entry.errors += 1;
    if (!entry.firstUsedAt) entry.firstUsedAt = now;
    entry.lastUsedAt = now;
    usage.set(toolName, entry);
    scheduleUsageWrite();
  }

  /** Remember a started call so its result can be attributed; bounded. */
  function trackPending(callId, toolName) {
    if (pendingCalls.size >= PENDING_CALL_LIMIT) {
      // Drop the oldest half rather than grow without bound.
      const keys = [...pendingCalls.keys()].slice(0, Math.ceil(PENDING_CALL_LIMIT / 2));
      for (const key of keys) pendingCalls.delete(key);
    }
    pendingCalls.set(callId, { name: toolName, failed: false });
  }

  function markFailed(callId) {
    const pending = pendingCalls.get(callId);
    if (pending === undefined) return;
    pendingCalls.delete(callId);
    const entry = usage.get(pending.name);
    if (entry === undefined) return;
    entry.errors += 1;
    usage.set(pending.name, entry);
    scheduleUsageWrite();
  }

  /**
   * One session event. Four types matter:
   *
   *  - `tool/call` / `tool/result` — a model-direct call and its outcome;
   *  - `tool/ptc-dispatch-start` / `tool/ptc-dispatch` — a sub-call a PTC
   *    program made through the `run_code` SDK. These carry the real tool name
   *    and are the ONLY record of what a PTC session actually used.
   *
   * The `run_code` transport itself is NOT counted: in PTC mode it is the only
   * name on the wire, so counting it would bury every real tool under one
   * meaningless counter. The sub-dispatches it produces carry the signal.
   *
   * `tool/result` carries no tool name, so the name is recovered through the
   * id recorded when the call started. A result whose start was never seen (a
   * forked session replaying another session's results) is ignored rather than
   * guessed at.
   */
  function observeSessionEvent(_session, event) {
    try {
      if (!event || typeof event.type !== 'string') return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // ── model-direct calls ──
      if (event.type === 'tool/call') {
        const toolName = data.name;
        if (typeof toolName !== 'string' || toolName.length === 0) return;
        if (toolName === PTC_TRANSPORT_TOOL) return; // counted through its sub-dispatches
        trackPending(String(data.callId), toolName);
        bumpUsage(toolName, false);
        return;
      }
      if (event.type === 'tool/result') {
        const callId = typeof data.callId === 'string'
          ? data.callId
          : (data.message && typeof data.message.toolCallId === 'string' ? data.message.toolCallId : undefined);
        if (callId === undefined) return;
        if (data.error !== undefined || (data.message && data.message.isError === true)) markFailed(callId);
        else pendingCalls.delete(callId);
        return;
      }

      // ── PTC program sub-dispatches ──
      if (event.type === 'tool/ptc-dispatch-start') {
        const toolName = data.name;
        const subCallId = typeof data.subCallId === 'string' ? data.subCallId : undefined;
        if (typeof toolName !== 'string' || toolName.length === 0 || subCallId === undefined) return;
        // A nested run_code is the SDK re-entering the transport, not a tool use.
        if (toolName === PTC_TRANSPORT_TOOL) return;
        trackPending(subCallId, toolName);
        bumpUsage(toolName, false);
        return;
      }
      if (event.type === 'tool/ptc-dispatch') {
        const subCallId = typeof data.subCallId === 'string' ? data.subCallId : undefined;
        if (subCallId === undefined) return;
        if (data.isError === true || data.error !== undefined) markFailed(subCallId);
        else pendingCalls.delete(subCallId);
        return;
      }
    } catch { /* statistics must never break a turn */ }
  }

  /** Rows for the 使用统计 tab: union of counted tools and the current catalog. */
  function usageRows(exec) {
    const rows = new Map();
    for (const tool of catalogFor(exec)) {
      rows.set(tool.name, {
        name: tool.name,
        count: 0,
        errors: 0,
        firstUsedAt: null,
        lastUsedAt: null,
        hidden: tool.hidden,
        protected: tool.protected,
        group: tool.group,
        memberOf: [],
      });
    }
    for (const group of groups) {
      for (const member of group.members) {
        const row = rows.get(member);
        if (row !== undefined) row.memberOf.push(groupToolName(group.key));
      }
    }
    for (const [toolName, entry] of usage) {
      const row = rows.get(toolName);
      if (row !== undefined) {
        Object.assign(row, {
          count: entry.count,
          errors: entry.errors,
          firstUsedAt: entry.firstUsedAt,
          lastUsedAt: entry.lastUsedAt,
        });
        continue;
      }
      // A tool this host no longer registers (uninstalled plugin, MCP server
      // gone) keeps its history in the table instead of vanishing silently.
      rows.set(toolName, {
        name: toolName,
        count: entry.count,
        errors: entry.errors,
        firstUsedAt: entry.firstUsedAt,
        lastUsedAt: entry.lastUsedAt,
        hidden: false,
        protected: false,
        group: groupFor(toolName),
        memberOf: [],
      });
    }
    return [...rows.values()].sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
  }

  /**
   * The advice column. Deliberately conservative — only two patterns are
   * strong enough to be worth stating, everything else stays blank:
   *  - never called + still always-injected → it is a candidate for a group;
   *  - hidden (or grouped) yet still being called → the threshold is wrong.
   */
  function suggestionFor(row) {
    const grouped = row.memberOf.length > 0;
    if (row.protected) return '';
    if (row.count === 0) {
      if (row.hidden) return '';
      return '从未调用 · 可考虑移入分组';
    }
    if (row.hidden) return '已隐藏但仍在调用 · 分组门槛可能过高';
    if (grouped && row.count >= 20) return '高频率调用 · 建议常驻';
    return '';
  }

  // ── tool groups (progressive disclosure) ───────────────────────────────────
  /**
   * Normalize a raw groups array: keep the four contract fields, drop invalid
   * keys/duplicates, dedupe members, ignore unknown member names, and preserve
   * unknown per-group fields for the next rewrite.
   */
  function normalizeGroups(raw, lenient = false) {
    const byKey = new Map();
    const known = knownToolNames();
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const key = typeof entry.key === 'string' ? entry.key : '';
      if (!GROUP_KEY_RE.test(key) || byKey.has(key)) continue;
      const members = [];
      const seen = new Set();
      for (const member of Array.isArray(entry.members) ? entry.members : []) {
        if (typeof member !== 'string' || seen.has(member)) continue;
        if (FORBIDDEN_MEMBERS.has(member) || isGroupToolName(member)) continue;
        seen.add(member);
        // Strict mode (a settings-page save) refuses names this host cannot
        // resolve yet. Lenient mode (loading the state file) keeps them: at
        // plugin start the registry is still filling up, so MCP/agent-scoped
        // tools are not registered yet and dropping them would silently empty
        // whole groups on every restart.
        if (!lenient && known.size > 0 && !known.has(member)) continue;
        members.push(member);
      }
      const extra = {};
      for (const [field, value] of Object.entries(entry)) {
        if (field === 'key' || field === 'label' || field === 'intro' || field === 'members' || field === 'enabled') continue;
        extra[field] = value;
      }
      if (Object.keys(extra).length > 0) extraGroupFields.set(key, extra);
      byKey.set(key, {
        key,
        label: typeof entry.label === 'string' && entry.label.length > 0 ? entry.label : key,
        intro: typeof entry.intro === 'string' ? entry.intro : '',
        members,
        enabled: entry.enabled !== false,
      });
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Every tool name this registry view knows (global view, best effort). */
  function knownToolNames() {
    const names = new Set();
    try {
      for (const schema of ctx.tools.schemas()) names.add(schema.name);
    } catch {
      // No registry view: validation degrades to the structural rules only.
    }
    return names;
  }

  /**
   * Validate a candidate groups array. Returns an error string or null; the
   * caller applies nothing unless this passes (fail-closed).
   */
  function validateGroups(next, lenient = false) {
    const keys = new Set();
    const groupTools = new Set();
    const known = knownToolNames();
    for (const group of next) {
      const label = 'group ' + JSON.stringify(group.key);
      if (!GROUP_KEY_RE.test(group.key)) return label + ': key must match ' + GROUP_KEY_RE;
      if (keys.has(group.key)) return label + ': duplicate key';
      keys.add(group.key);
      groupTools.add(groupToolName(group.key));
    }
    for (const group of next) {
      const label = 'group ' + JSON.stringify(group.key);
      for (const member of group.members) {
        if (FORBIDDEN_MEMBERS.has(member)) return label + ': member ' + member + ' is reserved';
        if (isGroupToolName(member)) return label + ': member ' + member + ' is a disclosure tool';
        if (groupTools.has(member)) return label + ': member ' + member + ' belongs to another group';
        if (!lenient && known.size > 0 && !known.has(member)) return label + ': member ' + member + ' is not a known tool';
      }
    }
    for (const group of next) {
      if (group.enabled && group.members.length === 0) return 'group ' + JSON.stringify(group.key) + ': enabled group needs at least one member';
    }
    return null;
  }

  /** Disclosure set of one scope (created on demand). */
  function disclosedFor(scopeKey) {
    if (scopeKey === undefined) return new Set();
    let set = disclosed.get(scopeKey);
    if (set === undefined) disclosed.set(scopeKey, (set = new Set()));
    return set;
  }

  /** Members still withheld from one scope. */
  function deniedMembers(scopeKey, agentCtx) {
    if (scopeKey === undefined || agentCtx === undefined) return [];
    const open = disclosed.get(scopeKey) ?? new Set();
    const deny = [];
    for (const group of groups) {
      if (!group.enabled) continue;
      if (open.has(group.key)) continue;
      for (const member of group.members) deny.push(member);
    }
    return [...new Set(deny)];
  }

  /** Install (or reinstall) one agent's member restriction. */
  function installAgentFilter(scopeKey, agentCtx) {
    if (scopeKey === undefined || agentCtx === undefined) return;
    // Hidden tools are denied at this layer too, so a disclosure can never
    // resurrect one: hidden stays the outer switch in every agent view.
    let deny = [...new Set([
      ...deniedMembers(scopeKey, agentCtx),
      ...[...hidden].filter((entry) => !RESERVED_TOOLS.has(entry)),
    ])];
    // Members registered in the agent's own layer are not restrictable at all:
    // dsh refuses the whole filter for them. Drop every such name and keep the
    // rest of the filter — one scope-local tool must not leave a whole group (or
    // the hidden set) visible. Names already learned are skipped up front.
    if (unrestrictable.size > 0) {
      deny = deny.filter((entry) => !unrestrictable.has(entry));
    }
    // Reinstalling an identical restriction used to happen on EVERY prompt
    // assembly (dispose + restrict + re-scan the registry). That synchronous
    // work on the host event loop is what starved the HTTP/Connection path and
    // froze the web client. Same deny set => nothing to do.
    const signature = deny.slice().sort().join('\n');
    if (agentFilters.has(scopeKey) && agentFilterSignatures.get(scopeKey) === signature) return;
    const previous = agentFilters.get(scopeKey);
    if (previous !== undefined) {
      try { previous(); } catch { /* already released */ }
      agentFilters.delete(scopeKey);
    }
    agentFilterSignatures.delete(scopeKey);
    if (deny.length === 0) return;
    const scoped = agentCtx.get('tools');
    if (process.env.TV_DEBUG) console.log('[tv] install', { hasScopeKey: scopeKey !== undefined, scoped: typeof scoped, restrict: typeof scoped?.restrict, deny });
    if (scoped === undefined || typeof scoped.restrict !== 'function') return;
    const dropped = [];
    for (;;) {
      try {
        const dispose = scoped.restrict({ deny });
        agentFilters.set(scopeKey, dispose);
        agentFilterSignatures.set(scopeKey, deny.slice().sort().join('\n'));
        const fresh = dropped.filter((entry) => !warnedUnrestrictable.has(entry));
        if (fresh.length > 0) {
          for (const entry of fresh) warnedUnrestrictable.add(entry);
          console.warn('[' + name + '] scope-local tool(s) not restrictable here, left visible: ' + fresh.join(', '));
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const unknown = unrestrictableNames(message).filter((entry) => deny.includes(entry));
        if (unknown.length === 0) {
          console.warn('[' + name + '] group restriction failed: ' + message);
          return;
        }
        dropped.push(...unknown);
        for (const entry of unknown) unrestrictable.add(entry);
        deny = deny.filter((entry) => !unknown.includes(entry));
        if (deny.length === 0) return;
      }
    }
  }

  /** Disclosure tools of the current configuration, re-registered on change. */
  function registerGroupTools() {
    for (const dispose of groupToolDisposers) {
      try { dispose(); } catch { /* already released */ }
    }
    groupToolDisposers = [];
    for (const group of groups) {
      if (!group.enabled) continue;
      const key = group.key;
                  groupToolDisposers.push(ctx.tools.register({
        name: groupToolName(key),
        // Contract: the disclosure tool's description IS the group intro.
        description: group.intro,
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              group: { type: 'string' },
              disclosed: { type: 'array', items: { type: 'string' } },
              message: { type: 'string' },
            },
          },
          render(_args, value) {
            return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
          },
        },
        async execute(_args, exec) {
          const scopeKey = exec && exec.agent && exec.agent.ctx
            ? scopeKeyOf(exec.agent.ctx)
            : scopeFor(exec);
          const open = disclosedFor(scopeKey);
          open.add(key);
          if (exec && exec.agent) installAgentFilter(scopeKey, exec.agent.ctx);
          return {
            group: key,
            disclosed: groups.filter((entry) => entry.enabled && open.has(entry.key)).map((entry) => entry.key),
            message: 'group ' + key + ' disclosed for this session; its tools are visible from the next model step',
          };
        },
      }));
    }
  }

  /** Every agent this host currently knows, best effort. */
  function liveAgents() {
    try {
      const registry = ctx.get('agents');
      return registry && typeof registry.list === 'function' ? registry.list() : [];
    } catch {
      return [];
    }
  }

  /** Install the current filter for one agent and return its scope key. */
  function ensureAgent(agent) {
    if (!agent || !agent.ctx) return undefined;
    const scopeKey = scopeKeyOf(agent.ctx);
    if (scopeKey === undefined) return undefined;
    installAgentFilter(scopeKey, agent.ctx);
    return scopeKey;
  }

  /** Install filters for every live agent (used before assembly and after edits). */
  function ensureAllAgents() {
    const startedAt = Date.now();
    let count = 0;
    for (const agent of liveAgents()) {
      count += 1;
      try { ensureAgent(agent); } catch { /* one agent's failure must not stop the rest */ }
    }
    const took = Date.now() - startedAt;
    // Runs inside system-prompt/assemble, i.e. on the host's request path: a
    // slow pass here is exactly what makes the web client look frozen.
    if (took >= SLOW_MS) {
      console.warn('[' + name + '] ensureAllAgents ' + count + ' agent(s) took ' + took + 'ms');
    }
  }

  /** Re-register disclosure tools and reinstall every agent's filter. */
  function applyGroups() {
    // Prune disclosure entries naming a group that no longer exists (deleted or
    // disabled): a stale key would keep a removed group 'open' forever.
    const liveKeys = new Set(groups.filter((group) => group.enabled).map((group) => group.key));
    for (const open of disclosed.values()) {
      for (const key of [...open]) if (!liveKeys.has(key)) open.delete(key);
    }
    registerGroupTools();
    ensureAllAgents();
  }
  // ── filtering ──────────────────────────────────────────────────────────────
  // Fallback listener, registered lazily and only when `restrict` is not
  // usable from the mounting scope. Removes hidden schemas from the assembled
  // prompt (the exact list that becomes the model request's `tools` field).
  let waterfallRegistered = false;
  const waterfall = async (assembly, _context, next) => {
    if (hidden.size === 0) return next();
    const result = await next();
    return {
      ...result,
      tools: result.tools.filter((tool) => !hidden.has(tool.name) || RESERVED_TOOLS.has(tool.name)),
    };
  };
  const ensureWaterfall = () => {
    if (!waterfallRegistered) {
      ctx.on('system-prompt/assemble', waterfall);
      waterfallRegistered = true;
    }
  };

  /** (Re)apply the current hidden set as a registry restriction. */
  function applyFilter() {
    if (lift) {
      lift();
      lift = null;
    }
    const deny = [...hidden].filter((entry) => !RESERVED_TOOLS.has(entry));
    if (deny.length === 0) {
      filterMode = 'none';
      return;
    }
    try {
      lift = ctx.tools.restrict({ deny });
      filterMode = 'restrict';
      return;
    } catch (error) {
      // dsh >= 0.1.7-rc.1 rejects a deny entry that names no current global
      // tool — a hidden tool whose owning plugin was removed, or one registered
      // scope-locally. Drop exactly the names dsh quoted (it reports them all in
      // one error) so a single stale entry cannot downgrade every remaining tool
      // to the prompt-only filter; the waterfall still covers what was dropped.
      const message = error instanceof Error ? error.message : String(error);
      const unknown = unrestrictableNames(message).filter((entry) => deny.includes(entry));
      if (unknown.length > 0) {
        const fresh = unknown.filter((entry) => !warnedUnrestrictable.has(entry));
        if (fresh.length > 0) {
          for (const entry of fresh) warnedUnrestrictable.add(entry);
          console.warn('[' + name + '] not restrictable here, left visible: ' + fresh.join(', '));
        }
        const current = deny.filter((entry) => !unknown.includes(entry));
        if (current.length > 0) {
          try {
            lift = ctx.tools.restrict({ deny: current });
            filterMode = 'restrict';
            return;
          } catch {
            // Fall through to the waterfall.
          }
        } else {
          filterMode = 'none';
          return;
        }
      }
    }
    ensureWaterfall();
    filterMode = 'waterfall';
  }

  // ── shared state helpers ───────────────────────────────────────────────────
  /** Current schemas one scope's model sees (post-restriction). */
  const visibleSchemas = (exec) => ctx.tools.schemas(scopeFor(exec));

  /**
   * The manageable subset of {@link visibleSchemas}: what the settings page and
   * the manager tool list. Runtime plumbing such as the PTC transport is
   * excluded even though the model does see it.
   */
  const listableSchemas = (exec) => visibleSchemas(exec).filter((schema) => !UNLISTED_TOOLS.has(schema.name));

  /**
   * Complete tool catalog for the UI: visible schemas ∪ hidden names.
   * Hidden tools vanish from `schemas()` under `restrict`, so the UI must
   * merge them back (from the state cache) or they could never be re-shown.
   */
  const catalogFor = (exec) => {
    const byName = new Map();
    for (const schema of listableSchemas(exec)) {
      byName.set(schema.name, typeof schema.description === 'string' ? schema.description : '');
    }
    for (const name of hidden) {
      if (!byName.has(name)) byName.set(name, descriptions.get(name) ?? '');
    }
    return [...byName.entries()].map(([name, description]) => ({
      name,
      description,
      group: groupFor(name),
      hidden: hidden.has(name),
      /** Reserved names render locked in the UI and are refused by every writer. */
      protected: RESERVED_TOOLS.has(name),
    })).sort((a, b) => a.name.localeCompare(b.name));
  };

  const uiState = (exec, persistError) => ({
    tools: catalogFor(exec),
    hidden: [...hidden].sort(),
    stateFile,
    filterMode,
    persistError: persistError || null,
  });

  /** Set the hidden flag of one tool, re-apply the filter and persist. */
  async function setHidden(name, hide, exec) {
    if (RESERVED_TOOLS.has(name)) return { error: `refusing to touch reserved tool ${name}` };
    if (hide) {
      hidden.add(name);
      const schema = visibleSchemas(exec).find((entry) => entry.name === name);
      if (schema && typeof schema.description === 'string') descriptions.set(name, schema.description);
    } else {
      hidden.delete(name);
      descriptions.delete(name);
    }
    applyFilter();
    ensureAllAgents();
    const persistError = await persistSafely();
    return { persistError };
  }

  /** Set the hidden flag of every tool whose group matches. */
  async function setGroupHidden(group, hide, exec) {
    let changed = false;
    for (const entry of catalogFor(exec)) {
      if (entry.protected) continue;
      if (entry.group !== group) continue;
      if (hide) {
        hidden.add(entry.name);
        if (entry.description) descriptions.set(entry.name, entry.description);
      } else {
        hidden.delete(entry.name);
        descriptions.delete(entry.name);
      }
      changed = true;
    }
    if (!changed) return { error: `no tools in group "${group}"` };
    applyFilter();
    ensureAllAgents();
    const persistError = await persistSafely();
    return { persistError };
  }

  // ── browser UI RPC (Settings → 工具注入控制) ───────────────────────────────
  /** One `/tool-visibility` RPC endpoint (list / set / set-group / reset). */
  const handleRpcInner = async (endpoint, payload) => {
    try {
      // A hand-edited state file is picked up on the next page load/refresh.
      if (endpoint === 'list' || endpoint === 'groups-list') {
        const reloadStarted = Date.now();
        await reloadStateIfChanged(endpoint === 'list' && !!(payload && payload.reload));
        const reloadTook = Date.now() - reloadStarted;
        if (reloadTook >= SLOW_STEP_MS) {
          console.warn('[' + name + '] ' + endpoint + ' step reloadStateIfChanged took ' + reloadTook + 'ms');
        }
      }
      if (endpoint === 'list') {
        const startedAt = Date.now();
        const state = uiState(null);
        const took = Date.now() - startedAt;
        if (took >= SLOW_STEP_MS) console.warn('[' + name + '] list step uiState took ' + took + 'ms');
        return rpcOk(state);
      }
      if (endpoint === 'set') {
        const name = payload && typeof payload.name === 'string' ? payload.name : null;
        const hide = !!(payload && payload.hidden);
        if (!name) return rpcErr('bad-request', 'missing tool name');
        const result = await setHidden(name, hide, null);
        if (result.error) return rpcErr('bad-request', result.error);
        return rpcOk(uiState(null, result.persistError));
      }
      if (endpoint === 'set-group') {
        const group = payload && typeof payload.group === 'string' ? payload.group : null;
        const hide = !!(payload && payload.hidden);
        if (!group) return rpcErr('bad-request', 'missing group');
        const result = await setGroupHidden(group, hide, null);
        if (result.error) return rpcErr('bad-request', result.error);
        return rpcOk(uiState(null, result.persistError));
      }
      if (endpoint === 'groups-list') {
        // Members are kept verbatim in memory (a lenient load cannot know which
        // names a not-yet-mounted plugin will provide), but the UI should only
        // offer the members this host can actually resolve right now.
        const liveNames = knownToolNames();
        return rpcOk({
          groups: groups.map((group) => ({
            ...group,
            tool: groupToolName(group.key),
            members: group.members.filter((member) => liveNames.size === 0 || liveNames.has(member)),
          })),
          tools: catalogFor(null),
          stateFile,
        });
      }
      if (endpoint === 'groups-save') {
        const raw = payload && Array.isArray(payload.groups) ? payload.groups : null;
        if (raw === null) return rpcErr('bad-request', 'missing groups array');
        // Structural rejections run on the RAW payload: normalization dedupes
        // keys, so a duplicate-key payload must be refused before it can
        // collapse into a valid configuration.
        const rawKeys = raw.map((entry) => (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.key : undefined));
        const seenRaw = new Set();
        for (const key of rawKeys) {
          if (typeof key !== 'string' || !GROUP_KEY_RE.test(key)) return rpcErr('bad-request', 'group key must match ' + GROUP_KEY_RE);
          if (seenRaw.has(key)) return rpcErr('bad-request', 'duplicate group key ' + JSON.stringify(key));
          seenRaw.add(key);
        }
        // Member rules also run on the RAW payload: normalization drops
        // forbidden/unknown names, so a fail-closed rejection has to happen
        // before that sanitation can turn it into a valid-but-empty group.
        const rawGroupTools = new Set(raw
          .map((entry) => (entry && typeof entry === 'object' && typeof entry.key === 'string' ? groupToolName(entry.key) : undefined))
          .filter((entry) => typeof entry === 'string'));
        for (const entry of raw) {
          if (!entry || typeof entry !== 'object' || !Array.isArray(entry.members)) continue;
          for (const member of entry.members) {
            if (typeof member !== 'string') return rpcErr('bad-request', 'group members must be strings');
            if (FORBIDDEN_MEMBERS.has(member)) return rpcErr('bad-request', 'member ' + member + ' is reserved and cannot join a group');
            if (isGroupToolName(member)) return rpcErr('bad-request', 'member ' + member + ' is a disclosure tool');
            if (rawGroupTools.has(member)) return rpcErr('bad-request', 'member ' + member + ' belongs to another group');
            // A name this host does not register is IGNORED, not rejected: a config
            // written on another profile may legitimately name absent tools, and
            // the contract asks for a safe ignore on both save and load.
          }
        }
        const next = normalizeGroups(raw);
        const problem = validateGroups(next);
        if (problem !== null) return rpcErr('bad-request', problem);
        const previousGroups = groups;
        groups = next;
        try {
          applyGroups();
          await persist();
        } catch (error) {
          // Roll back the in-memory configuration and the registrations together:
          // a failed apply/write must not leave runtime state ahead of the file.
          groups = previousGroups;
          try { applyGroups(); } catch { /* the previous configuration is best-effort */ }
          const reason = error instanceof Error ? error.message : String(error);
          return rpcErr('internal', 'groups-save rolled back: ' + reason);
        }
        return rpcOk({
          groups: groups.map((group) => ({ ...group, tool: groupToolName(group.key) })),
          stateFile,
        });
      }
      if (endpoint === 'usage-list') {
        return rpcOk({
          rows: usageRows(null).map((row) => ({ ...row, suggestion: suggestionFor(row) })),
          usageFile,
          loadedAt: usageLoadedAt,
          stateFile,
        });
      }
      if (endpoint === 'usage-reset') {
        usage.clear();
        pendingCalls.clear();
        // Flush synchronously (awaited) so an immediate re-read cannot resurrect rows.
        if (usageTimer !== null) {
          clearTimeout(usageTimer);
          usageTimer = null;
        }
        try {
          await writeUsage();
        } catch (error) {
          return rpcErr('internal', 'usage reset not persisted: '
            + (error instanceof Error ? error.message : String(error)));
        }
        return rpcOk({
          rows: usageRows(null).map((row) => ({ ...row, suggestion: suggestionFor(row) })),
          usageFile,
          loadedAt: usageLoadedAt,
          stateFile,
        });
      }
      if (endpoint === 'reset') {
        hidden.clear();
        descriptions.clear();
        applyFilter();
        const persistError = await persistSafely();
        return rpcOk(uiState(null, persistError));
      }
      return rpcErr('bad-request', `unknown endpoint: ${endpoint}`);
    } catch (error) {
      return rpcErr('internal', error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * Every browser round-trip is timed. A hung handler used to be invisible: the
   * settings page stayed on 加载中… and nothing reached the log, so the only
   * symptom was "the web client froze". Now a slow endpoint names itself.
   */
  const handleRpc = async (endpoint, payload) => {
    const startedAt = Date.now();
    try {
      return await handleRpcInner(endpoint, payload);
    } finally {
      const took = Date.now() - startedAt;
      if (took >= SLOW_MS) {
        console.warn('[' + name + '] rpc ' + endpoint + ' took ' + took + 'ms');
      }
    }
  };

  // ── disclosed-tools prompt section (system prompt; never conversation history)
  // Rendered from the calling scope's live disclosure set, so a disclosed group's
  // members are announced by name plus a one-line intro without touching messages.
  const firstSentence = (text) => {
    const trimmed = String(text ?? '').trim();
    if (trimmed.length === 0) return '';
    const cut = /[。.;；!?\n]/.exec(trimmed);
    return cut === null ? trimmed : trimmed.slice(0, cut.index);
  };
  if (systemPrompt && typeof systemPrompt.section === 'function') {
    const sdkOrder = (() => {
      try { return systemPrompt.getSectionOrder('TOOLS_SDK'); } catch { return 5000; }
    })();
    systemPrompt.section({
      name: 'tool-visibility:disclosed',
      order: sdkOrder + 1,
      interpolate: false,
      text: (context) => {
        const scopeKey = context && context.scope;
        const open = scopeKey === undefined ? undefined : disclosed.get(scopeKey);
        if (open === undefined || open.size === 0) return '';
        let schemas = [];
        try { schemas = ctx.tools.schemas(scopeKey) ?? []; } catch { /* no view: names only */ }
        const described = new Map(schemas.map((schema) => [schema.name, typeof schema.description === 'string' ? schema.description : '']));
        const seen = new Set();
        const lines = [];
        for (const group of groups) {
          if (!group.enabled || !open.has(group.key)) continue;
          for (const member of group.members) {
            if (hidden.has(member) || seen.has(member)) continue;
            seen.add(member);
            const intro = firstSentence(group.intro) || firstSentence(described.get(member));
            lines.push(intro.length > 0 ? '- ' + member + ' — ' + intro : '- ' + member);
          }
        }
        if (lines.length === 0) return '';
        return '## Disclosed tools (this session)\n\n' + lines.join('\n')
          + '\n\nThese tools were disclosed by calling their group tool; call them like any other tool.';
      },
    });
  }

  // Test hook: exposes the RPC handler to the plugin's own test harness. Not
  // used by the shipping host path (the webServer route below is the surface).
  if (config && typeof config.__onRpc === 'function') config.__onRpc(handleRpc);

  /** Body cap: every payload here is a tool name, a group name, or nothing. */
  const RPC_BODY_LIMIT = 64 * 1024;
  /** Endpoint below the channel, or undefined when the pathname is not ours. */
  const endpointOf = (url) => {
    const pathname = new URL(url ?? '/', 'http://dsh.internal').pathname;
    if (!pathname.startsWith(`${RPC_CHANNEL}/`)) return undefined;
    const endpoint = pathname.slice(RPC_CHANNEL.length + 1);
    const segments = endpoint.split('/');
    return segments.every((segment) => /^[A-Za-z0-9_$.-]+$/.test(segment)) ? endpoint : undefined;
  };
  /** Request body as JSON, or undefined when empty, oversized, or unparsable. */
  const readJsonBody = async (req) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > RPC_BODY_LIMIT) return undefined;
      chunks.push(chunk);
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  };
  const writeJson = (res, value) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };

  // The channel is a webServer route, so it is mounted from a context that
  // injects BOTH `webServer` (the route table) and `connection` (the Host/Origin
  // + browser-session fence). Neither exists while this root row applies in the
  // web profile, and reading an un-injected service is fatal in current cordis
  // — hence `ctx.inject` instead of probing once at apply time.
  //
  // The route is registered here rather than through `connection.rpc.handle`
  // because that helper resolves `webServer` through the *channel service's*
  // own context, which never injects it (`cannot get property "webServer"
  // without inject`). The wire envelope below is the same Connection RPC
  // contract the browser half sends through `ctx.connection.rpc.call`.
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    if (typeof webCtx.connection.requestRejection !== 'function') {
      console.warn(`[${name}] connection service exposes no requestRejection(); ${RPC_CHANNEL} channel not mounted`);
      return;
    }
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: RPC_CHANNEL,
      handler: async (req, res) => {
        const rejection = webCtx.connection.requestRejection(req);
        if (rejection !== undefined) {
          res.writeHead(rejection);
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
          return;
        }
        const endpoint = endpointOf(req.url);
        if (req.method !== 'POST' || endpoint === undefined) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const contentType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
        if (contentType !== 'application/json') {
          res.writeHead(415);
          res.end('content type must be application/json');
          return;
        }
        const message = await readJsonBody(req);
        if (message === undefined || message.type !== 'client-request' || typeof message.rpcId !== 'string' || typeof message.method !== 'string') {
          res.writeHead(400);
          res.end('body is not a connection client-request');
          return;
        }
        if (message.method !== endpoint) {
          writeJson(res, { type: 'server-response', rpcId: message.rpcId, result: rpcErr('gateway/bad-request', `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`) });
          return;
        }
        writeJson(res, { type: 'server-response', rpcId: message.rpcId, result: await handleRpc(endpoint, message.payload) });
      },
    }), `${name}: ${RPC_CHANNEL} channel`);
  });

  ctx.tools.register({
    name: MANAGER_TOOL,
    description: 'Control which tool schemas are injected into the model context of this session. ' +
      'Actions: "list" (every visible tool with its hidden state), "hide" (remove the named tools from the model context — ' +
      'they also become uncallable via UNKNOWN_TOOL), "show" (restore the named tools), "reset" (clear the hidden set). ' +
      'The reserved tools ' + [...RESERVED_TOOLS].sort().join(' and ') + ' can never be hidden. ' +
      'Changes persist to the plugin state file and take effect on the next model step.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'hide', 'show', 'reset'],
          description: 'What to do: list | hide | show | reset.',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tool names the action applies to (required for hide/show; ignored for list/reset).',
        },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hidden: { type: 'array', items: { type: 'string' } },
          visible: { type: 'array', items: { type: 'string' } },
          reserved: { type: 'array', items: { type: 'string' } },
          stateFile: { type: 'string' },
          filterMode: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
      },
    },
    async execute(args, exec) {
      const action = args.action;
      const st = (extra) => ({ hidden: [...hidden].sort(), stateFile, reserved: [...RESERVED_TOOLS].sort(), ...extra });
      const vis = () => listableSchemas(exec).map((s) => s.name).sort();
      if (action === 'list') {
        return {
          ...st(),
          visible: vis(),
          filterMode,
          message: `${vis().length} tools visible, ${hidden.size} hidden`
            + ` (never hidden: ${[...RESERVED_TOOLS].sort().join(', ')})`,
        };
      }
      if (action === 'reset') {
        hidden.clear();
        descriptions.clear();
        applyFilter();
        const persistError = await persistSafely();
        return { ...st(), visible: vis(), filterMode, message: persistError ? 'hidden set cleared but ' + persistError : 'hidden set cleared' };
      }
      const names = Array.isArray(args.tools) ? args.tools.filter((entry) => typeof entry === 'string') : [];
      if (names.length === 0) {
        return { ...st(), visible: vis(), filterMode, message: `no tool names given for "${action}"` };
      }
      // Reserved names are answered before the unknown-name check so the
      // refusal reads the same even where a reserved tool is not projected
      // (a native-mode scope has no `run_code` in `schemas()`).
      const reserved = names.filter((entry) => RESERVED_TOOLS.has(entry));
      if (reserved.length > 0) {
        return {
          ...st(),
          visible: vis(),
          filterMode,
          message: `refusing to change reserved tool(s): ${reserved.join(', ')} — these are never hidden `
            + `(${MANAGER_TOOL} is this control surface; run_code is the PTC transport)`,
        };
      }
      const known = new Set(vis());
      const unknown = names.filter((entry) => !known.has(entry) && !hidden.has(entry));
      if (unknown.length > 0) {
        return { ...st(), visible: vis(), filterMode, message: `unknown tool name(s): ${unknown.join(', ')}` };
      }
      let persistError = null;
      if (action === 'hide') {
        for (const entry of names) {
          const result = await setHidden(entry, true, exec);
          if (result.error) return { ...st(), visible: vis(), filterMode, message: result.error };
          if (result.persistError) persistError = result.persistError;
        }
      } else if (action === 'show') {
        for (const entry of names) {
          const result = await setHidden(entry, false, exec);
          if (result.error) return { ...st(), visible: vis(), filterMode, message: result.error };
          if (result.persistError) persistError = result.persistError;
        }
      } else {
        return { ...st(), visible: vis(), filterMode, message: `unknown action "${action}"` };
      }
      return { ...st(), visible: vis(), filterMode, message: `${action} applied to ${names.join(', ')} — takes effect on the next model step` + (persistError ? ' (warning: ' + persistError + ')' : '') };
    },
  });

  // ── start with persisted state ─────────────────────────────────────────────
  await load();
  // Statistics are a separate file and a separate failure domain: a corrupt or
  // unwritable stats file must never stop the filter from loading.
  try {
    await loadUsage();
  } catch { /* start with empty counters */ }
  ctx.on('session/event', observeSessionEvent);
  // Groups loaded from disk must register their disclosure tools and install the
  // per-agent member restriction NOW: without this they only took effect after
  // the first settings-page save, so a fresh session saw every grouped tool.
  applyGroups();
  applyFilter();
  ctx.on('agent/created', ({ agent }) => {
    try { ensureAgent(agent); } catch { /* never break agent creation */ }
  });
  // Release one agent's restriction and drop its session state with the agent.
  ctx.on('agent/disposed', ({ agent }) => {
    try {
      const scopeKey = !agent || !agent.ctx ? undefined : scopeKeyOf(agent.ctx);
      if (scopeKey === undefined) return;
      const dispose = agentFilters.get(scopeKey);
      if (dispose !== undefined) {
        try { dispose(); } catch { /* already released */ }
        agentFilters.delete(scopeKey);
      }
      agentFilterSignatures.delete(scopeKey);
      disclosed.delete(scopeKey);
    } catch { /* never break agent teardown */ }
  });
  // Every assembly re-asserts the per-agent member restriction. This is what
  // makes a freshly built agent (and an agent whose filter was released with its
  // previous scope) see exactly the configured surface, without waiting for a
  // settings-page save. Kept synchronous and allocation-free: an async listener
  // here once blocked the HTTP assembly path.
  ctx.on('system-prompt/assemble', (_assembly, _context, next) => {
    try { ensureAllAgents(); } catch { /* one agent's failure must not stop assembly */ }
    return next();
  });
  // // BINARY DEBUG: assemble listener disabled - causes HTTP timeout
//   // ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
//     ensureAllAgents();
//     const result = await next();
//     // Evidence hook: when TV_DUMP_SDK names a file, append one JSON record per
//     // assembly so a real-host run can show the exact tools:sdk text the model saw.
//     const dump = process.env.TV_DUMP_SDK;
//     if (dump) {
//       try {
//         const sdk = result.sections.find((section) => section.name === 'tools:sdk');
//         const record = {
//           at: new Date().toISOString(),
//           tools: result.tools.map((tool) => tool.name),
//           sdkText: sdk ? sdk.text : null,
//           disclosedText: (result.sections.find((section) => section.name === 'tool-visibility:disclosed') || {}).text ?? null,
//           sectionNames: result.sections.map((section) => section.name),
//           scopeTools: (() => {
//             try {
//               const scope = _context && _context.scope;
//               return scope === undefined ? null : ctx.tools.schemas(scope).map((schema) => schema.name).sort();
//             } catch { return null; }
//           })(),
//         };
//         await writeFile(dump, JSON.stringify(record) + '\n', { flag: 'a' });
//       } catch { /* evidence hook must never break assembly */ }
//     }
//     return result;
//   // }, { prepend: true });
}
