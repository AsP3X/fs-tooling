// Human: Side filter dialog — ordered colored rules. Saving a default forks a restorable custom copy.
// Agent: READS page().filters. CALLS onChange with a new filters array. CALLS onLayout after editor size changes.

import { blankFilter, CRITERION_GROUPS, criteriaFor, criterionActive, forkFromBuiltin, isForkOfDefault, moveFilter, restoreFromSource } from '../lib/filters';
import { getModuleId, page } from '../lib/state';
import { escapeHtml } from '../lib/text';
import type { FilterRule, MatchMode } from '../lib/types';
import { groupSummary, mountCriterion } from './criteria';

const SWATCHES = ['#e65100', '#c62828', '#6a1b9a', '#1565c0', '#2e7d32'];

export function initManage(
  shadow: ShadowRoot,
  hooks: { onChange: (filters: FilterRule[]) => void; onLayout?: () => void },
): { sync: () => void } {
  const list = shadow.getElementById('filterList');
  const editor = shadow.getElementById('filterEditor');
  const newBtn = shadow.getElementById('newFilter');
  if (!list || !editor) {
    return { sync: () => {} };
  }

  let editingId: string | null = null;
  let seededId: string | null = null;
  const openGroups = new Set<string>();

  const commit = (filters: FilterRule[]): void => {
    hooks.onChange(filters);
    requestAnimationFrame(() => hooks.onLayout?.());
  };

  const renderEditor = (rule: FilterRule): void => {
    const moduleId = getModuleId();
    const forked = isForkOfDefault(rule);
    const fields = criteriaFor(moduleId);
    if (seededId !== rule.id) {
      const sameFork = !!rule.sourceId && rule.sourceId === seededId;
      if (!sameFork) {
        openGroups.clear();
        CRITERION_GROUPS.forEach((g) => {
          const ids = fields.filter((f) => f.group === g.id).map((f) => f.id);
          if (ids.some((id) => criterionActive(id, rule.criteria)) || g.id === 'age') openGroups.add(g.id);
        });
      }
      seededId = rule.id;
    }
    editor.classList.remove('hide');
    editor.innerHTML = `
      <span class="label">${rule.builtin ? 'Default filter' : 'Edit filter'}</span>
      <p class="hint">${rule.builtin ? 'Saving creates a custom copy. The original default stays restorable.' : forked ? 'Custom copy of a default. Restore resets its rules.' : 'Saved on each change.'}</p>
      <label class="range-field"><span>Name</span>
        <input id="filterName" type="text" maxlength="40" value="${escapeHtml(rule.name)}" />
      </label>
      <div class="row-between"><span class="label">Match</span>
        <div class="seg" id="filterMatch">
          <button type="button" data-mode="and"${rule.matchMode === 'and' ? ' class="on"' : ''}>All</button>
          <button type="button" data-mode="or"${rule.matchMode !== 'and' ? ' class="on"' : ''}>Any</button>
        </div>
      </div>
      <button type="button" class="chip${rule.invert ? ' on' : ''}" id="filterInvert">Invert</button>
      <p class="hint">${rule.invert ? 'Paints rows that miss these rules.' : 'Paints rows that match these rules.'}</p>
      <div class="chips" id="filterSwatches">
        ${SWATCHES.map((c) => `<button type="button" class="swatch${c.toLowerCase() === rule.color.toLowerCase() ? ' on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}
        <input type="color" id="filterColor" value="${escapeHtml(rule.color)}" style="width:26px;height:26px;border:0;padding:0;background:none;cursor:pointer" />
      </div>
      <div id="filterFields"></div>
      <div class="chips">
        <button class="ghost" id="closeEditor" type="button" style="flex:1">Done</button>
        ${forked ? '<button class="ghost" id="restoreEditor" type="button" style="flex:1">Restore default</button>' : ''}
        ${rule.builtin ? '' : '<button class="ghost" id="delEditor" type="button" style="flex:1">Delete</button>'}
      </div>`;

    const fieldsHost = editor.querySelector('#filterFields') as HTMLElement;
    CRITERION_GROUPS.forEach((group) => {
      const specs = fields.filter((f) => f.group === group.id);
      if (!specs.length) return;
      const box = document.createElement('div');
      const open = openGroups.has(group.id);
      box.className = `tagbox editor-group${open ? ' open' : ''}`;
      const summary = groupSummary(specs.map((s) => s.id), rule.criteria);
      box.innerHTML = `
        <button type="button" class="tagbox-head" data-group="${group.id}">
          <span class="label">${escapeHtml(group.label)}</span>
          <span style="display:flex;align-items:center;gap:6px"><span class="tag-count">${escapeHtml(summary)}</span><span class="chev">▸</span></span>
        </button>
        <div class="tagbox-body"></div>
        ${group.hint && open ? `<p class="hint">${escapeHtml(group.hint)}</p>` : ''}`;
      const body = box.querySelector('.tagbox-body') as HTMLElement;
      specs.forEach((spec) => {
        const block = document.createElement('div');
        block.className = 'editor-field';
        mountCriterion(block, spec.id, rule.criteria, moduleId, (patch) => {
          patchRule(rule.id, { criteria: { ...rule.criteria, ...patch } });
        });
        body.appendChild(block);
      });
      box.querySelector('.tagbox-head')?.addEventListener('click', () => {
        if (openGroups.has(group.id)) openGroups.delete(group.id);
        else openGroups.add(group.id);
        const latest = (page().filters || []).find((r) => r.id === rule.id) || rule;
        renderEditor(latest);
      });
      fieldsHost.appendChild(box);
    });

    const nameInput = editor.querySelector('#filterName') as HTMLInputElement | null;
    nameInput?.addEventListener('keydown', (e) => e.stopPropagation());
    nameInput?.addEventListener('change', () => {
      const name = nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 40);
      if (name) patchRule(rule.id, { name });
    });
    editor.querySelectorAll('#filterMatch button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = ((btn as HTMLElement).dataset.mode || 'or') as MatchMode;
        patchRule(rule.id, { matchMode: mode });
      });
    });
    editor.querySelector('#filterInvert')?.addEventListener('click', () => {
      patchRule(rule.id, { invert: !rule.invert });
    });
    editor.querySelectorAll('#filterSwatches .swatch').forEach((btn) => {
      btn.addEventListener('click', () => patchRule(rule.id, { color: (btn as HTMLElement).dataset.color || rule.color }));
    });
    editor.querySelector('#filterColor')?.addEventListener('change', (e) => {
      patchRule(rule.id, { color: (e.target as HTMLInputElement).value });
    });
    editor.querySelector('#closeEditor')?.addEventListener('click', () => {
      editingId = null;
      seededId = null;
      editor.classList.add('hide');
      editor.innerHTML = '';
      editor.removeAttribute('data-editing');
      requestAnimationFrame(() => hooks.onLayout?.());
    });
    editor.querySelector('#restoreEditor')?.addEventListener('click', () => {
      const restored = restoreFromSource(rule, getModuleId());
      if (!restored) return;
      const next = (page().filters || []).map((r) => (r.id === rule.id ? restored : r));
      editingId = restored.id;
      commit(next);
    });
    editor.querySelector('#delEditor')?.addEventListener('click', () => {
      if (!confirm(`Delete “${rule.name}”?`)) return;
      editingId = null;
      const list = page().filters || [];
      const i = list.findIndex((r) => r.id === rule.id);
      const next = list.filter((r) => r.id !== rule.id);
      if (rule.sourceId) {
        const restored = restoreFromSource(rule, getModuleId());
        if (restored && i >= 0) next.splice(i, 0, { ...restored, enabled: false });
      }
      commit(next);
    });
    requestAnimationFrame(() => hooks.onLayout?.());
  };

  function patchRule(id: string, partial: Partial<FilterRule>): void {
    const list = page().filters || [];
    const cur = list.find((r) => r.id === id);
    if (!cur) return;
    const content = 'name' in partial || 'criteria' in partial || 'matchMode' in partial || 'color' in partial || 'invert' in partial;
    if (cur.builtin && content) {
      const fork = forkFromBuiltin({
        ...cur,
        ...partial,
        criteria: partial.criteria || cur.criteria,
      });
      editingId = fork.id;
      commit(list.map((r) => (r.id === id ? fork : r)));
      return;
    }
    commit(list.map((r) => (r.id === id ? { ...r, ...partial, criteria: partial.criteria || r.criteria } : r)));
  }

  const renderList = (): void => {
    const filters = page().filters || [];
    list.innerHTML = filters.map((rule, i) => `
      <div class="filter-row" data-id="${escapeHtml(rule.id)}">
        <span class="filter-swatch" style="background:${escapeHtml(rule.color)}"></span>
        <span class="filter-name">${escapeHtml(rule.name)}</span>
        <span class="filter-tags">${rule.builtin ? '<span class="tag-count">Default</span>' : isForkOfDefault(rule) ? '<span class="tag-count">Custom</span>' : ''}${rule.invert ? '<span class="tag-count">Invert</span>' : ''}</span>
        <button type="button" class="icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} title="Higher priority">↑</button>
        <button type="button" class="icon-btn" data-act="down" ${i === filters.length - 1 ? 'disabled' : ''} title="Lower priority">↓</button>
        <button type="button" class="toggle${rule.enabled ? ' on' : ''}" data-act="on" title="Active"><i></i></button>
        <button type="button" class="ghost" data-act="edit" style="height:28px;padding:0 8px">Edit</button>
      </div>`).join('');
    list.querySelectorAll<HTMLElement>('.filter-row').forEach((row) => {
      const id = row.dataset.id || '';
      row.querySelector('[data-act="up"]')?.addEventListener('click', () => commit(moveFilter(page().filters || [], id, -1)));
      row.querySelector('[data-act="down"]')?.addEventListener('click', () => commit(moveFilter(page().filters || [], id, 1)));
      row.querySelector('[data-act="on"]')?.addEventListener('click', () => {
        commit((page().filters || []).map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
      });
      row.querySelector('[data-act="edit"]')?.addEventListener('click', () => {
        editingId = id;
        const rule = (page().filters || []).find((r) => r.id === id);
        if (rule) renderEditor(rule);
      });
    });
    if (editingId) {
      const rule = filters.find((r) => r.id === editingId);
      if (!rule) {
        editingId = null;
        seededId = null;
        editor.classList.add('hide');
        editor.innerHTML = '';
        editor.removeAttribute('data-editing');
      } else {
        const active = shadow.activeElement;
        const typing = !!(active && editor.contains(active) && active instanceof HTMLInputElement && active.type === 'text');
        if (!typing || editor.dataset.editing !== rule.id) {
          renderEditor(rule);
          editor.dataset.editing = rule.id;
        }
      }
    }
  };

  newBtn?.addEventListener('click', () => {
    const created = blankFilter(getModuleId());
    commit([...(page().filters || []), created]);
    editingId = created.id;
  });

  const sync = (): void => {
    renderList();
    requestAnimationFrame(() => hooks.onLayout?.());
  };

  return { sync };
}
