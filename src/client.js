/**
 * dsh-tool-visibility — browser half.
 *
 * Registers a settings page (Settings → 工具注入控制) listing every model-facing
 * tool grouped by raw name prefix, with per-tool and whole-group toggles and a
 * name/description search. All state lives on the Host half; this UI talks to
 * it over the `/tool-visibility` Connection RPC channel (endpoints:
 * list / set / set-group / reset), styled with the native DSH theme tokens.
 */
import React, { useState, useEffect, useCallback } from 'react';

export const name = 'dsh-tool-visibility-client';

export const inject = ['slots', 'connection'];

const CHANNEL = '/tool-visibility';

/** Native-style CSS using the DSH theme tokens (light/dark aware). */
const CSS = `
.tvi-root{color:var(--dsw-alias-label-primary);font-family:inherit}
.tvi-title{margin:0 0 4px;font-size:16px;font-weight:600;line-height:24px}
.tvi-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0 0 14px}
.tvi-bar{display:flex;gap:8px;margin-bottom:12px}
.tvi-search{flex:1;min-width:0;height:32px;padding:0 10px;font-size:13px;font-family:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;outline:none}
.tvi-search:focus{border-color:var(--dsw-alias-brand-primary)}
.tvi-search::placeholder{color:var(--dsw-alias-label-secondary)}
.tvi-btn{height:32px;padding:0 12px;font-size:13px;font-family:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer}
.tvi-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}
.tvi-btn:active{opacity:.85}
.tvi-btn:disabled{opacity:.5;cursor:default}
.tvi-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin:0 0 8px}
.tvi-warn{color:var(--dsw-alias-state-warn-primary);font-size:12px;margin:0 0 8px}
.tvi-list{max-height:58vh;overflow-y:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px;background:var(--dsw-alias-bg-layer-1)}
.tvi-list::-webkit-scrollbar{width:8px}
.tvi-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(128,128,128,.3));border-radius:4px}
.tvi-list::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2,rgba(128,128,128,.45))}
.tvi-empty{padding:20px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px}
.tvi-group{margin:2px 0}
.tvi-group-head{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;user-select:none}
.tvi-group-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}
.tvi-group-caret{font-size:10px;width:14px;color:var(--dsw-alias-label-secondary);transition:transform .12s;flex:none}
.tvi-group-caret.collapsed{transform:rotate(-90deg)}
.tvi-group-name{font-size:13px;font-weight:600}
.tvi-group-badge{font-size:11px;padding:1px 8px;border-radius:10px;background:rgba(128,128,128,.12);color:var(--dsw-alias-label-secondary)}
.tvi-group-badge.hot{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 15%,transparent);color:var(--dsw-alias-state-error-primary)}
.tvi-group-body{padding-left:28px}
.tvi-row{display:flex;align-items:center;gap:8px;padding:3px 8px;border-radius:6px;cursor:pointer}
.tvi-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.06))}
.tvi-row input[type=checkbox],.tvi-group-head input[type=checkbox]{accent-color:var(--dsw-alias-brand-primary);width:14px;height:14px;cursor:pointer;flex:none}
.tvi-name{min-width:170px;font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.tvi-desc{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tvi-row.hidden .tvi-name{opacity:.6;text-decoration:line-through}
.tvi-row.hidden .tvi-desc{opacity:.5}
.tvi-manager{opacity:.7}
`;

export function apply(ctx) {
  const slots = ctx.get('slots');
  if (slots === undefined) return;

  /** One Connection RPC round-trip; returns the decoded value or throws. */
  const call = async (endpoint, payload) => {
    const result = await ctx.connection.call(CHANNEL, endpoint, payload);
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

    const refresh = useCallback(async () => {
      try {
        setError(null);
        setData(await call('list', {}));
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
    const toggleCollapse = (label) => setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));

    if (!data) {
      return React.createElement('div', { className: 'tvi-root', style: { padding: '24px' } },
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

    const toolRow = (tool) => React.createElement('label', {
      key: tool.name,
      className: 'tvi-row' + (tool.hidden ? ' hidden' : '') + (tool.name === 'tool_visibility' ? ' tvi-manager' : ''),
    },
      React.createElement('input', {
        type: 'checkbox',
        checked: !!tool.hidden,
        disabled: busy || tool.name === 'tool_visibility',
        onChange: () => toggle(tool.name, !!tool.hidden),
      }),
      React.createElement('code', { className: 'tvi-name' }, tool.name),
      React.createElement('span', { className: 'tvi-desc' },
        tool.hidden ? '（已隐藏，不注入上下文）' : (tool.description || '')),
    );

    const groupRows = groupEntries.map(([label, tools]) => {
      const total = tools.length;
      const groupHidden = tools.filter((t) => t.hidden).length;
      const allHidden = groupHidden === total;
      const someHidden = groupHidden > 0 && groupHidden < total;
      const isCollapsed = !!collapsed[label];
      return React.createElement('div', { key: label, className: 'tvi-group' },
        React.createElement('div', { className: 'tvi-group-head', onClick: () => toggleCollapse(label) },
          React.createElement('span', { className: 'tvi-group-caret' + (isCollapsed ? ' collapsed' : '') }, '▾'),
          React.createElement('input', {
            type: 'checkbox',
            checked: allHidden,
            ref: (el) => { if (el) el.indeterminate = someHidden; },
            disabled: busy || tools.every((t) => t.name === 'tool_visibility'),
            onClick: (e) => e.stopPropagation(),
            onChange: () => toggleGroup(label, allHidden),
          }),
          React.createElement('span', { className: 'tvi-group-name' }, label),
          React.createElement('span', { className: 'tvi-group-badge' + (groupHidden > 0 ? ' hot' : '') },
            groupHidden > 0 ? `${groupHidden}/${total} 隐藏` : `${total} 个`),
        ),
        isCollapsed ? null : React.createElement('div', { className: 'tvi-group-body' }, tools.map(toolRow)),
      );
    });

    return React.createElement('div', { className: 'tvi-root' },
      React.createElement('h3', { className: 'tvi-title' }, 'Tool 注入控制'),
      React.createElement('p', { className: 'tvi-sub' },
        `状态文件: ${data.stateFile || '不可用'} · 过滤机制: ${data.filterMode || 'none'} · 共 ${shown.length} 个工具，已隐藏 ${hiddenCount} 个`),
      React.createElement('div', { className: 'tvi-bar' },
        React.createElement('input', {
          type: 'search',
          className: 'tvi-search',
          placeholder: '搜索工具名或描述…',
          value: query,
          onChange: (e) => setQuery(e.target.value),
        }),
        React.createElement('button', { className: 'tvi-btn', onClick: refresh, disabled: busy }, '刷新'),
        React.createElement('button', { className: 'tvi-btn', onClick: resetAll, disabled: busy }, '全部恢复'),
      ),
      error && React.createElement('div', { className: 'tvi-err' }, error),
      data.persistError && React.createElement('div', { className: 'tvi-warn' }, '持久化警告: ' + data.persistError),
      React.createElement('div', { className: 'tvi-list' },
        filtered.length === 0
          ? React.createElement('div', { className: 'tvi-empty' }, '无匹配工具')
          : groupRows,
      ),
    );
  }

  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'tool-visibility', order: 25, label: '工具注入控制' },
    () => React.createElement(ToolVisibilityPage),
  ));
}
