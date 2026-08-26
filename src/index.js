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
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const name = 'dsh-tool-visibility';

export const inject = ['tools'];

const MANAGER_TOOL = 'tool_visibility';
const RPC_CHANNEL = '/tool-visibility';

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
  const stateFile = (config && typeof config.stateFile === 'string' && config.stateFile) || defaultStateFile();
  const hidden = new Set();
  /** Tool-name → description cache, kept for hidden tools so the UI can show them. */
  const descriptions = new Map();
  /** 'restrict' | 'waterfall' | 'none' — which filter actually applies. */
  let filterMode = 'none';
  let lift = null; // disposer of the active registry restriction

  // Optional scope support: `@deepseek-ai/dsh-scope` is a dsh-install built-in,
  // present when the runtime loads our package from the same tree, but not
  // guaranteed for registry installs in foreign profiles. Absent → global view.
  let scopeOf = null;
  try {
    scopeOf = (await import('@deepseek-ai/dsh-scope')).scopeOf;
  } catch {
    scopeOf = null;
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
    try {
      const parsed = JSON.parse(await readFile(stateFile, 'utf8'));
      if (parsed && Array.isArray(parsed.hidden)) {
        for (const entry of parsed.hidden) {
          if (typeof entry === 'string') hidden.add(entry);
        }
      }
      if (parsed && parsed.descriptions && typeof parsed.descriptions === 'object') {
        for (const [key, value] of Object.entries(parsed.descriptions)) {
          if (typeof value === 'string') descriptions.set(key, value);
        }
      }
    } catch {
      // Missing or corrupt state file: start with an empty hidden set.
    }
  }

  async function persist() {
    await mkdir(path.dirname(stateFile), { recursive: true });
    const state = { hidden: [...hidden].sort() };
    if (descriptions.size > 0) {
      state.descriptions = Object.fromEntries([...descriptions.entries()].sort());
    }
    await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
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

  // ── filtering ──────────────────────────────────────────────────────────────
  // Fallback listener, registered lazily and only when `restrict` is not
  // usable from the mounting scope. Removes hidden schemas from the assembled
  // prompt (the exact list that becomes the model request's `tools` field).
  let waterfallRegistered = false;
  const waterfall = async (assembly, _context, next) => {
    if (hidden.size === 0) return next();
    const result = await next();
    return { ...result, tools: result.tools.filter((tool) => !hidden.has(tool.name)) };
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
    const deny = [...hidden].filter((entry) => entry !== MANAGER_TOOL);
    if (deny.length === 0) {
      filterMode = hidden.size === 0 ? 'none' : filterMode;
      return;
    }
    try {
      lift = ctx.tools.restrict({ deny });
      filterMode = 'restrict';
    } catch {
      ensureWaterfall();
      filterMode = 'waterfall';
    }
  }

  // ── shared state helpers ───────────────────────────────────────────────────
  /** Current schemas one scope's model sees (post-restriction). */
  const visibleSchemas = (exec) => ctx.tools.schemas(scopeFor(exec));

  /**
   * Complete tool catalog for the UI: visible schemas ∪ hidden names.
   * Hidden tools vanish from `schemas()` under `restrict`, so the UI must
   * merge them back (from the state cache) or they could never be re-shown.
   */
  const catalogFor = (exec) => {
    const byName = new Map();
    for (const schema of visibleSchemas(exec)) {
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
    if (name === MANAGER_TOOL) return { error: `refusing to touch ${MANAGER_TOOL}` };
    if (hide) {
      hidden.add(name);
      const schema = visibleSchemas(exec).find((entry) => entry.name === name);
      if (schema && typeof schema.description === 'string') descriptions.set(name, schema.description);
    } else {
      hidden.delete(name);
      descriptions.delete(name);
    }
    applyFilter();
    const persistError = await persistSafely();
    return { persistError };
  }

  /** Set the hidden flag of every tool whose group matches. */
  async function setGroupHidden(group, hide, exec) {
    let changed = false;
    for (const entry of catalogFor(exec)) {
      if (entry.name === MANAGER_TOOL) continue;
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
    const persistError = await persistSafely();
    return { persistError };
  }

  // ── browser UI RPC (Settings → 工具注入控制) ───────────────────────────────
  const connection = ctx.get('connection');
  if (connection && connection.rpc) {
    connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
      try {
        if (endpoint === 'list') return rpcOk(uiState(null));
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
    }, { authority: 'loopback' });
  }

  // ── model-facing manager tool (hand-rolled definition: no dsh-tools import) ─
  ctx.tools.register({
    name: MANAGER_TOOL,
    description: 'Control which tool schemas are injected into the model context of this session. ' +
      'Actions: "list" (every visible tool with its hidden state), "hide" (remove the named tools from the model context — ' +
      'they also become uncallable via UNKNOWN_TOOL), "show" (restore the named tools), "reset" (clear the hidden set). ' +
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
      const st = (extra) => ({ hidden: [...hidden].sort(), stateFile, ...extra });
      const vis = () => visibleSchemas(exec).map((s) => s.name).sort();
      if (action === 'list') {
        return { ...st(), visible: vis(), filterMode, message: `${vis().length} tools visible, ${hidden.size} hidden` };
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
      const known = new Set(vis());
      const unknown = names.filter((entry) => !known.has(entry) && !hidden.has(entry));
      if (unknown.length > 0) {
        return { ...st(), visible: vis(), filterMode, message: `unknown tool name(s): ${unknown.join(', ')}` };
      }
      if (names.includes(MANAGER_TOOL)) {
        return { ...st(), visible: vis(), filterMode, message: `refusing to hide ${MANAGER_TOOL} (you would lose control of this filter)` };
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
  applyFilter();
}
