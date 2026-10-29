/* dsh-tool-visibility — browser half.
 *
 * Served directly by the web client-modules table (./client exports subpath)
 * and must therefore be a `window.__ModuleLoader__.load({ id, factory })`
 * bundle: the factory receives `require`, runs at materialization, and returns
 * the cordis client plugin (`apply` + `inject`). Registers a settings page
 * (Settings → 工具注入控制) listing every model-facing tool grouped by raw name
 * prefix, with per-tool and whole-group toggles and a name/description search.
 * Reserved tools (`tool_visibility` and the PTC transport `run_code`) arrive
 * with `protected: true` and render locked.
 * All state lives on the Host half; this UI talks to it over the
 * `/tool-visibility` Connection RPC channel (list / set / set-group / reset).
 */
window.__ModuleLoader__.load({
  id: '@rayfalling/dsh-tool-visibility',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    let React = require('react');
    let useState = React.useState;
    let useEffect = React.useEffect;
    let useCallback = React.useCallback;
    let h = React.createElement;

    // Native-style CSS using the DSH theme tokens (light/dark aware).
    // Injected at materialization, mirroring the built client bundles.
    const CSS = [
      '.tvi-root{color:var(--dsw-alias-label-primary);font-family:inherit}',
      '.tvi-title{margin:0 0 4px;font-size:16px;font-weight:600;line-height:24px}',
      '.tvi-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0 0 14px}',
      '.tvi-bar{display:flex;gap:8px;margin-bottom:12px}',
      '.tvi-search{flex:1;min-width:0;height:32px;padding:0 10px;font-size:13px;font-family:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;outline:none}',
      '.tvi-search:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.tvi-search::placeholder{color:var(--dsw-alias-label-secondary)}',
      '.tvi-btn{height:32px;padding:0 12px;font-size:13px;font-family:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer}',
      '.tvi-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}',
      '.tvi-btn:active{opacity:.85}',
      '.tvi-btn:disabled{opacity:.5;cursor:default}',
      '.tvi-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin:0 0 8px}',
      '.tvi-warn{color:var(--dsw-alias-state-warn-primary);font-size:12px;margin:0 0 8px}',
      '.tvi-list{max-height:58vh;overflow-y:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px;background:var(--dsw-alias-bg-layer-1)}',
      '.tvi-list::-webkit-scrollbar{width:8px}',
      '.tvi-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(128,128,128,.3));border-radius:4px}',
      '.tvi-list::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2,rgba(128,128,128,.45))}',
      '.tvi-empty{padding:20px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.tvi-group{margin:2px 0}',
      '.tvi-block{margin-top:2px}',
      '.tvi-block .tvi-bar{margin-bottom:8px}',
      '.tvi-group-head{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;user-select:none}',
      '.tvi-group-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}',
      '.tvi-group-caret{font-size:10px;width:14px;color:var(--dsw-alias-label-secondary);transition:transform .12s;flex:none}',
      '.tvi-group-caret.collapsed{transform:rotate(-90deg)}',
      '.tvi-group-name{font-size:13px;font-weight:600}',
      '.tvi-group-badge{font-size:11px;padding:1px 8px;border-radius:10px;background:rgba(128,128,128,.12);color:var(--dsw-alias-label-secondary)}',
      '.tvi-group-badge.hot{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 15%,transparent);color:var(--dsw-alias-state-error-primary)}',
      '.tvi-group-body{padding-left:28px}',
      '.tvi-row{display:flex;align-items:center;gap:8px;padding:3px 8px;border-radius:6px;cursor:pointer}',
      '.tvi-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.06))}',
      '.tvi-row input[type=checkbox],.tvi-group-head input[type=checkbox]{accent-color:var(--dsw-alias-brand-primary);width:14px;height:14px;cursor:pointer;flex:none}',
      '.tvi-name{min-width:170px;font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      '.tvi-desc{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tvi-row.hidden .tvi-name{opacity:.6;text-decoration:line-through}',
      '.tvi-row.hidden .tvi-desc{opacity:.5}',
      '.tvi-locked{opacity:.7}',
      // ── sub-tabs ──
      '.tvi-tabs{display:flex;gap:4px;margin:0 0 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.tvi-tab{height:32px;padding:0 14px;font-size:13px;font-family:inherit;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-bottom:2px solid transparent;cursor:pointer;margin-bottom:-1px}',
      '.tvi-tab:hover{color:var(--dsw-alias-label-primary)}',
      '.tvi-tab.active{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}',
      // ── usage table ──
      '.tvi-table{width:100%;border-collapse:collapse;font-size:12.5px}',
      '.tvi-table th{position:sticky;top:0;text-align:left;font-weight:600;font-size:11.5px;color:var(--dsw-alias-label-secondary);padding:6px 8px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}',
      '.tvi-table td{padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle}',
      '.tvi-table tr:hover td{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.06))}',
      '.tvi-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.tvi-dim{color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.tvi-tag{display:inline-block;font-size:11px;padding:0 6px;border-radius:8px;background:rgba(128,128,128,.14);color:var(--dsw-alias-label-secondary)}',
      '.tvi-tag.hot{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 15%,transparent);color:var(--dsw-alias-state-error-primary)}',
      '.tvi-tag.cold{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 15%,transparent);color:var(--dsw-alias-state-warn-primary)}',
    ].join('');
    const CSS_TAG = '@rayfalling/dsh-tool-visibility/css';
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']') === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = '@rayfalling/dsh-tool-visibility';
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    const CHANNEL = '/tool-visibility';

    function apply(ctx) {
      const slots = ctx.get('slots');
      if (slots === undefined) return;

      /** Hard ceiling for one settings-page round-trip: a Host that never
       *  answers must surface as an error the page can show, never as a
       *  permanent "加载中…" (which reads to the user as a frozen client). */
      const RPC_TIMEOUT_MS = 5000;
      /** One Connection RPC round-trip; returns the decoded value or throws. */
      const call = async (endpoint, payload) => {
        const connection = ctx.get('connection');
        if (connection === undefined || typeof connection.rpc?.call !== 'function') {
          throw new Error('connection not yet available');
        }
        const startedAt = Date.now();
        let timer;
        const timeout = new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error('RPC ' + endpoint + ' 超时 (' + RPC_TIMEOUT_MS + 'ms)：宿主未在该时限内响应'));
          }, RPC_TIMEOUT_MS);
        });
        let result;
        try {
          result = await Promise.race([connection.rpc.call(CHANNEL, endpoint, payload), timeout]);
        } catch (e) {
          if (e && /超时/.test(String(e.message))) {
            console.warn('[tool-visibility] ' + endpoint + ' timed out after ' + (Date.now() - startedAt) + 'ms');
          }
          throw e;
        } finally {
          clearTimeout(timer);
        }
        if (result.ok) return result.value;
        const message = result.error && result.error.message ? result.error.message : 'RPC failed';
        throw new Error(message);
      };

      function ToolVisibilityPage() {
        const [data, setData] = useState(null);
        const [error, setError] = useState(null);
        const [busy, setBusy] = useState(false);
        const [query, setQuery] = useState('');
        const [collapsed, setCollapsed] = useState({});
        /** Open group-config cards (default collapsed: one header row per group). */
        const [openGroups, setOpenGroups] = useState({});
        /** Whether the whole bottom tool-visibility block is expanded. */
        const [toolsOpen, setToolsOpen] = useState(true);
        /** Group configuration shown in the 分组 block (groups-list). */
        const [groupConfigs, setGroupConfigs] = useState([]);
        const [groupBusy, setGroupBusy] = useState(false);
        const [draft, setDraft] = useState(null);
        /** Active sub-tab: 'tools' (过滤/分组) or 'usage' (使用统计). */
        const [tab, setTab] = useState('tools');
        /** Usage rows from the Host, or null while the tab was never opened. */
        const [usageData, setUsageData] = useState(null);
        const [usageError, setUsageError] = useState(null);
        const [usageBusy, setUsageBusy] = useState(false);
        const [usageQuery, setUsageQuery] = useState('');

        const refresh = useCallback(async () => {
          try {
            setError(null);
            // reload:true asks the Host to re-read $DSH_HOME/tool-visibility.json,
            // so 刷新 picks up a file edited by hand (or by another process).
            setData(await call('list', { reload: true }));
            const listed = await call('groups-list', {});
            setGroupConfigs(Array.isArray(listed.groups) ? listed.groups : []);
          } catch (e) {
            setError(e && e.message ? e.message : String(e));
          }
        }, []);

        useEffect(() => {
          refresh();
        }, [refresh]);

        const run = async (endpoint, args) => {
          setBusy(true);
          try {
            setError(null);
            setData(await call(endpoint, args));
          } catch (e) {
            setError(e && e.message ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        };
        const toggle = (name, hiddenNow) => run('set', { name, hidden: !hiddenNow });
        const toggleGroup = (group, allHidden) => run('set-group', { group, hidden: !allHidden });
        const resetAll = () => run('reset', {});
        const loadUsage = useCallback(async () => {
          setUsageBusy(true);
          try {
            setUsageError(null);
            setUsageData(await call('usage-list', {}));
          } catch (e) {
            setUsageError(e && e.message ? e.message : String(e));
          } finally {
            setUsageBusy(false);
          }
        }, []);
        // Load lazily: the statistics file is not read until the tab is opened,
        // so a slow disk never delays the filter view.
        useEffect(() => {
          if (tab === 'usage' && usageData === null && !usageBusy) loadUsage();
        }, [tab, usageData, usageBusy, loadUsage]);
        const resetUsage = async () => {
          if (typeof window !== 'undefined' && typeof window.confirm === 'function'
            && !window.confirm('确定清零所有工具使用统计？该操作不可撤销，过滤与分组配置不受影响。')) return;
          setUsageBusy(true);
          try {
            setUsageError(null);
            setUsageData(await call('usage-reset', {}));
          } catch (e) {
            setUsageError(e && e.message ? e.message : String(e));
          } finally {
            setUsageBusy(false);
          }
        };
        const toggleCollapse = (label) => setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
        const toggleGroupOpen = (key) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

        // ── tool groups (progressive disclosure) ──────────────────────────────
        const PLAIN_GROUP = (g) => ({
          key: g.key,
          label: g.label,
          intro: g.intro,
          members: Array.isArray(g.members) ? [...g.members] : [],
          enabled: g.enabled !== false,
        });
        const slugify = (text) => {
          const slug = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
          // A label with no ASCII letters (e.g. Chinese) still needs a unique,
          // valid key: derive one from a short timestamp suffix.
          return /^[a-z]/.test(slug) ? slug : 'grp' + Date.now().toString(36).slice(-4);
        };
        const saveGroups = async (next) => {
          setGroupBusy(true);
          try {
            setError(null);
            const saved = await call('groups-save', { groups: next.map(PLAIN_GROUP) });
            setGroupConfigs(Array.isArray(saved.groups) ? saved.groups : next);
            setDraft(null);
            await refresh();
          } catch (e) {
            setError(e && e.message ? e.message : String(e));
          } finally {
            setGroupBusy(false);
          }
        };
        const patchGroup = (key, patch) => saveGroups(groupConfigs.map((g) => (g.key === key ? { ...PLAIN_GROUP(g), ...patch } : PLAIN_GROUP(g))));
        const removeGroup = (key) => saveGroups(groupConfigs.filter((g) => g.key !== key).map(PLAIN_GROUP));
        const commitDraft = () => {
          if (draft === null) return;
          const key = draft.key || slugify(draft.label);
          // Open the freshly created group so its intro/member editor is visible.
          setOpenGroups((prev) => ({ ...prev, [key]: true }));
          saveGroups([...groupConfigs.map(PLAIN_GROUP), { ...PLAIN_GROUP(draft), key }]);
        };
        const toggleMember = (groupKey, name) => {
          const group = groupConfigs.find((g) => g.key === groupKey);
          if (group === undefined) return;
          const members = group.members.includes(name)
            ? group.members.filter((m) => m !== name)
            : [...group.members, name];
          patchGroup(groupKey, { members });
        };

        if (!data) {
          return h('div', { className: 'tvi-root', style: { padding: '24px' } },
            error ? '加载失败: ' + error : '加载中…');
        }

        const shown = data.tools || [];
        const hiddenCount = data.hidden ? data.hidden.length : 0;
        const q = query.trim().toLowerCase();
        const filtered = q
          ? shown.filter((t) => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q))
          : shown;

        const groups = new Map();
        for (const tool of filtered) {
          const label = tool.group || 'other';
          if (!groups.has(label)) groups.set(label, []);
          groups.get(label).push(tool);
        }
        const groupEntries = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

        const toolRow = (tool) => h('label', {
          key: tool.name,
          className: 'tvi-row' + (tool.hidden ? ' hidden' : '') + (tool.protected ? ' tvi-locked' : ''),
        },
          h('input', {
            type: 'checkbox',
            // CHECKED = enabled (injected into the model context); unchecked = disabled.
            checked: !tool.hidden,
            // Reserved tools (tool_visibility, run_code) are never hideable.
            disabled: busy || !!tool.protected,
            onChange: () => toggle(tool.name, !!tool.hidden),
          }),
          h('code', { className: 'tvi-name' }, tool.name),
          h('span', { className: 'tvi-desc' },
            tool.protected
              ? '（框架保留，始终注入）'
              : tool.hidden ? '（未启用，不注入上下文）' : (tool.description || '')),
        );

        const groupRows = groupEntries.map(([label, tools]) => {
          const total = tools.length;
          const groupHidden = tools.filter((t) => t.hidden).length;
          const allEnabled = groupHidden === 0;
          const allHidden = groupHidden === total;
          const someDisabled = groupHidden > 0 && groupHidden < total;
          const isCollapsed = !!collapsed[label];
          return h('div', { key: label, className: 'tvi-group' },
            h('div', { className: 'tvi-group-head', onClick: () => toggleCollapse(label) },
              h('span', { className: 'tvi-group-caret' + (isCollapsed ? ' collapsed' : '') }, '▾'),
              h('input', {
                type: 'checkbox',
                // CHECKED = whole group enabled; unchecked = whole group disabled.
                checked: allEnabled,
                ref: (el) => { if (el) el.indeterminate = someDisabled; },
                disabled: busy || tools.every((t) => t.protected),
                onClick: (e) => e.stopPropagation(),
                onChange: () => toggleGroup(label, allHidden),
              }),
              h('span', { className: 'tvi-group-name' }, label),
              h('span', { className: 'tvi-group-badge' + (groupHidden > 0 ? ' hot' : '') },
                groupHidden > 0 ? `${groupHidden}/${total} 未启用` : `${total} 个`),
            ),
            isCollapsed ? null : h('div', { className: 'tvi-group-body' }, tools.map(toolRow)),
          );
        });

        const memberPicker = (group, onToggle) => h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px', padding: '4px 0 8px 28px' } },
          shown.filter((tool) => !tool.protected && !String(tool.name).startsWith('group_')).map((tool) =>
            h('label', { key: tool.name, style: { fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' } },
              h('input', {
                type: 'checkbox',
                checked: group.members.includes(tool.name),
                disabled: groupBusy,
                onChange: () => onToggle(tool.name),
              }),
              h('code', null, tool.name),
            )),
        );
        const allOpen = groupConfigs.length > 0 && groupConfigs.every((g) => !!openGroups[g.key]);
        const setAllOpen = (open) => setOpenGroups(open ? Object.fromEntries(groupConfigs.map((g) => [g.key, true])) : {});
        const groupsBlock = h('div', { style: { marginBottom: '14px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } },
            h('span', { className: 'tvi-group-name' }, '工具分组（渐进披露）'),
            h('button', {
              className: 'tvi-btn',
              disabled: groupBusy,
              onClick: () => setDraft({ key: '', label: '', intro: '', members: [], enabled: true }),
            }, '新建分组'),
            groupConfigs.length === 0 ? null : h('button', {
              className: 'tvi-btn',
              disabled: groupBusy,
              onClick: () => setAllOpen(!allOpen),
            }, allOpen ? '全部收起' : '全部展开'),
          ),
          h('p', { className: 'tvi-sub' },
            '启用后的分组只暴露一个披露工具 group_<key>，其描述就是组介绍；调用后组内工具才对模型可见。'),
          groupConfigs.length === 0 && draft === null
            ? h('div', { className: 'tvi-empty' }, '还没有分组')
            : null,
          groupConfigs.map((group) => {
            const open = !!openGroups[group.key];
            return h('div', { key: group.key, className: 'tvi-group' },
              h('div', {
                className: 'tvi-group-head',
                title: open ? '收起该分组' : '展开该分组的成员列表',
                onClick: () => toggleGroupOpen(group.key),
              },
                h('span', { className: 'tvi-group-caret' + (open ? '' : ' collapsed') }, '▾'),
                h('input', {
                  type: 'checkbox',
                  checked: group.enabled !== false,
                  disabled: groupBusy,
                  onClick: (e) => e.stopPropagation(),
                  onChange: () => patchGroup(group.key, { enabled: !(group.enabled !== false) }),
                }),
                h('code', { className: 'tvi-name', style: { minWidth: '130px' } }, 'group_' + group.key),
                h('input', {
                  className: 'tvi-search',
                  style: { flex: 1, minWidth: '120px', height: '26px' },
                  defaultValue: group.label,
                  disabled: groupBusy,
                  placeholder: '显示名',
                  onClick: (e) => e.stopPropagation(),
                  onFocus: () => { if (!open) toggleGroupOpen(group.key); },
                  onBlur: (e) => { if (e.target.value !== group.label) patchGroup(group.key, { label: e.target.value }); },
                }),
                h('span', { className: 'tvi-group-badge' }, group.members.length + ' 个成员'),
                h('button', {
                  className: 'tvi-btn',
                  disabled: groupBusy,
                  onClick: (e) => { e.stopPropagation(); removeGroup(group.key); },
                }, '删除'),
              ),
              open ? h('div', { className: 'tvi-group-body' },
                h('input', {
                  className: 'tvi-search',
                  style: { width: '100%', height: '26px', marginBottom: '6px' },
                  defaultValue: group.intro,
                  disabled: groupBusy,
                  placeholder: '组介绍（会作为 group_' + group.key + ' 的描述）',
                  onBlur: (e) => { if (e.target.value !== group.intro) patchGroup(group.key, { intro: e.target.value }); },
                }),
                memberPicker(group, (name) => toggleMember(group.key, name)),
              ) : null,
            );
          }),
          draft === null ? null : h('div', { className: 'tvi-group' },
            h('div', { className: 'tvi-group-head' },
              h('code', { className: 'tvi-name', style: { minWidth: '130px' } }, 'key: ' + (draft.key || slugify(draft.label))),
              h('input', {
                className: 'tvi-search',
                style: { flex: 1, minWidth: '120px', height: '26px' },
                value: draft.label,
                placeholder: '分组名（显示名）',
                onChange: (e) => setDraft({ ...draft, label: e.target.value }),
              }),
              h('button', { className: 'tvi-btn', disabled: groupBusy, onClick: commitDraft }, '保存分组'),
              h('button', { className: 'tvi-btn', disabled: groupBusy, onClick: () => setDraft(null) }, '取消'),
            ),
            h('div', { className: 'tvi-group-body' },
              h('input', {
                className: 'tvi-search',
                style: { width: '100%', height: '26px', marginBottom: '6px' },
                value: draft.intro,
                placeholder: '组介绍',
                onChange: (e) => setDraft({ ...draft, intro: e.target.value }),
              }),
              memberPicker(draft, (name) => setDraft((prev) => (prev === null ? prev : { ...prev, members: prev.members.includes(name) ? prev.members.filter((m) => m !== name) : [...prev.members, name] }))),
            ),
          ),
        );

        // ── 使用统计 tab ────────────────────────────────────────────────────
        const fmtTime = (iso) => {
          if (!iso) return '—';
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return '—';
          const pad = (n) => String(n).padStart(2, '0');
          return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
            + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        };
        const usageTab = (() => {
          if (usageError !== null) {
            return h('div', null,
              h('div', { className: 'tvi-err' }, usageError),
              h('button', { className: 'tvi-btn', onClick: loadUsage, disabled: usageBusy }, '重试'));
          }
          if (usageData === null) return h('div', { className: 'tvi-empty' }, usageBusy ? '加载中…' : '暂无数据');
          const rows = Array.isArray(usageData.rows) ? usageData.rows : [];
          const terms = usageQuery.trim().toLowerCase();
          const visible = terms
            ? rows.filter((row) => row.name.toLowerCase().includes(terms))
            : rows;
          const called = rows.filter((row) => row.count > 0).length;
          const never = rows.filter((row) => row.count === 0 && !row.protected).length;
          const totalCalls = rows.reduce((sum, row) => sum + row.count, 0);
          return h('div', null,
            h('p', { className: 'tvi-sub' },
              '跨会话累积 · 统计文件: ' + (usageData.usageFile || '不可用')
              + ' · 共 ' + rows.length + ' 个工具，已调用 ' + called + ' 个，从未调用 ' + never + ' 个，累计 ' + totalCalls + ' 次'),
            h('div', { className: 'tvi-bar' },
              h('input', {
                type: 'search',
                className: 'tvi-search',
                placeholder: '搜索工具名…',
                value: usageQuery,
                onChange: (e) => setUsageQuery(e.target.value),
              }),
              h('button', { className: 'tvi-btn', onClick: loadUsage, disabled: usageBusy }, '刷新'),
              h('button', { className: 'tvi-btn', onClick: resetUsage, disabled: usageBusy }, '清零统计'),
            ),
            h('div', { className: 'tvi-list' },
              visible.length === 0
                ? h('div', { className: 'tvi-empty' }, '无匹配工具')
                : h('table', { className: 'tvi-table' },
                  h('thead', null, h('tr', null,
                    h('th', null, '工具'),
                    h('th', { className: 'tvi-num' }, '调用'),
                    h('th', { className: 'tvi-num' }, '失败'),
                    h('th', null, '状态'),
                    h('th', null, '最近使用'),
                    h('th', null, '建议'),
                  )),
                  h('tbody', null, visible.map((row) => h('tr', { key: row.name },
                    h('td', null, h('code', { className: 'tvi-name', style: { minWidth: 0 } }, row.name)),
                    h('td', { className: 'tvi-num' }, row.count),
                    h('td', { className: 'tvi-num' }, row.errors > 0 ? row.errors : ''),
                    h('td', null,
                      row.protected
                        ? h('span', { className: 'tvi-tag' }, '常驻锁定')
                        : row.hidden
                          ? h('span', { className: 'tvi-tag cold' }, '已隐藏')
                          : row.memberOf.length > 0
                            ? h('span', { className: 'tvi-tag' }, row.memberOf.join(', '))
                            : h('span', { className: 'tvi-tag hot' }, '常驻'),
                    ),
                    h('td', { className: 'tvi-dim' }, fmtTime(row.lastUsedAt)),
                    h('td', { className: 'tvi-dim' }, row.suggestion || ''),
                  ))),
                ),
            ),
          );
        })();

        return h('div', { className: 'tvi-root' },
          h('h3', { className: 'tvi-title' }, 'Tool 注入控制'),
          h('p', { className: 'tvi-sub' },
            tab === 'usage'
              ? '工具调用次数按会话累积，跨会话保留；建议列给出是否适合移入分组。'
              : `状态文件: ${data.stateFile || '不可用'} · 过滤机制: ${data.filterMode || 'none'} · 共 ${shown.length} 个工具，未启用 ${hiddenCount} 个 · 勾选 = 启用`),
          h('div', { className: 'tvi-tabs' },
            h('button', {
              className: 'tvi-tab' + (tab === 'tools' ? ' active' : ''),
              onClick: () => setTab('tools'),
            }, '过滤与分组'),
            h('button', {
              className: 'tvi-tab' + (tab === 'usage' ? ' active' : ''),
              onClick: () => setTab('usage'),
            }, '使用统计'),
          ),
          tab === 'usage' ? usageTab : null,
          tab !== 'tools' ? null : h('div', { className: 'tvi-bar' },
            h('input', {
              type: 'search',
              className: 'tvi-search',
              placeholder: '搜索工具名或描述…',
              value: query,
              onChange: (e) => setQuery(e.target.value),
            }),
            h('button', { className: 'tvi-btn', onClick: refresh, disabled: busy }, '刷新'),
            h('button', { className: 'tvi-btn', onClick: resetAll, disabled: busy }, '全部恢复'),
          ),
          tab !== 'tools' ? null : error && h('div', { className: 'tvi-err' }, error),
          tab !== 'tools' ? null : data.persistError && h('div', { className: 'tvi-warn' }, '持久化警告: ' + data.persistError),
          tab !== 'tools' ? null : groupsBlock,
          tab !== 'tools' ? null : h('div', { className: 'tvi-block' },
            h('div', {
              className: 'tvi-group-head',
              title: toolsOpen ? '收起可见性设置' : '展开可见性设置',
              onClick: () => setToolsOpen((prev) => !prev),
            },
              h('span', { className: 'tvi-group-caret' + (toolsOpen ? '' : ' collapsed') }, '▾'),
              h('span', { className: 'tvi-group-name' }, '全部工具可见性'),
              h('span', { className: 'tvi-group-badge' + (hiddenCount > 0 ? ' hot' : '') },
                hiddenCount > 0 ? `共 ${shown.length} 个，未启用 ${hiddenCount} 个` : `共 ${shown.length} 个，全部启用`),
            ),
            toolsOpen ? h('div', { style: { paddingTop: '8px' } },
              h('div', { className: 'tvi-bar' },
                h('input', {
                  type: 'search',
                  className: 'tvi-search',
                  placeholder: '搜索工具名或描述…',
                  value: query,
                  onChange: (e) => setQuery(e.target.value),
                }),
                h('button', { className: 'tvi-btn', onClick: refresh, disabled: busy }, '刷新'),
                h('button', { className: 'tvi-btn', onClick: resetAll, disabled: busy }, '全部恢复'),
              ),
              h('div', { className: 'tvi-list' },
                filtered.length === 0
                  ? h('div', { className: 'tvi-empty' }, '无匹配工具')
                  : groupRows,
              ),
            ) : null,
          ),
        );
      }

      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'tool-visibility', order: 25, label: '工具注入控制' },
        () => h(ToolVisibilityPage),
      ));
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    return module.exports;
  },
});
