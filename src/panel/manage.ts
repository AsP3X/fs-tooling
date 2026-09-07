// Human: Side filter dialog — ordered colored rules. Saving a default forks a restorable custom copy.
// Agent: READS page().filters. CALLS onChange with a new filters array. CALLS onLayout after editor size changes.

import { formatStart, parseStartInput } from '../lib/dates';
import { blankFilter, criteriaFor, forkFromBuiltin, isForkOfDefault, moveFilter, restoreFromSource } from '../lib/filters';
import { collectRows } from '../lib/rows';
import { getModuleId, page } from '../lib/state';
import { escapeHtml } from '../lib/text';
import type { FilterCriteria, FilterRule, MatchMode } from '../lib/types';

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

  const commit = (filters: FilterRule[]): void => {
    hooks.onChange(filters);
    requestAnimationFrame(() => hooks.onLayout?.());
  };

  const renderEditor = (rule: FilterRule): void => {
    const moduleId = getModuleId();
    const forked = isForkOfDefault(rule);
    const fields = criteriaFor(moduleId);
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
    fields.forEach((spec) => {
      const block = document.createElement('div');
      block.className = 'editor-field';
      mountCriterion(block, spec.id, rule.criteria, false, (patch) => {
        patchRule(rule.id, { criteria: { ...rule.criteria, ...patch } });
      });
      fieldsHost.appendChild(block);
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
    editor.querySelectorAll('#filterSwatches .swatch').forEach((btn) => {
      btn.addEventListener('click', () => patchRule(rule.id, { color: (btn as HTMLElement).dataset.color || rule.color }));
    });
    editor.querySelector('#filterColor')?.addEventListener('change', (e) => {
      patchRule(rule.id, { color: (e.target as HTMLInputElement).value });
    });
    editor.querySelector('#closeEditor')?.addEventListener('click', () => {
      editingId = null;
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
    const content = 'name' in partial || 'criteria' in partial || 'matchMode' in partial || 'color' in partial;
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
        ${rule.builtin ? '<span class="tag-count">Default</span>' : isForkOfDefault(rule) ? '<span class="tag-count">Custom</span>' : ''}
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
        editor.classList.add('hide');
        editor.innerHTML = '';
        editor.removeAttribute('data-editing');
      } else {
        const active = shadow.activeElement;
        const typing = !!(active && editor.contains(active) && active instanceof HTMLInputElement);
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

function mountCriterion(
  host: HTMLElement,
  id: string,
  criteria: FilterCriteria,
  locked: boolean,
  onPatch: (patch: FilterCriteria) => void,
): void {
  const disabled = locked ? 'disabled' : '';
  if (id === 'idleDays') {
    const days = typeof criteria.idleDays === 'number' ? criteria.idleDays : 6;
    const on = criteria.idleDays != null;
    host.innerHTML = `
      <div class="row-between"><span class="label">Idle age</span>
        <button type="button" class="chip${on ? ' on' : ''}" data-idle-off ${disabled}>${on ? `${days}d` : 'Off'}</button>
      </div>
      <input type="range" min="1" max="45" step="1" value="${days}" ${disabled} />`;
    const idleChip = host.querySelector('[data-idle-off]');
    const idleRange = host.querySelector('input');
    idleChip?.addEventListener('click', () => {
      onPatch({ idleDays: on ? null : days });
    });
    idleRange?.addEventListener('input', (e) => {
      const value = Number((e.target as HTMLInputElement).value);
      if (idleChip) idleChip.textContent = `${value}d`;
    });
    idleRange?.addEventListener('change', (e) => {
      onPatch({ idleDays: Number((e.target as HTMLInputElement).value) });
    });
    return;
  }
  if (id === 'statuses') {
    const tags = Array.isArray(criteria.statuses) ? criteria.statuses : [];
    const hints = [...new Set(collectRows().map((r) => r.status).filter((s) => s && s !== '—'))]
      .filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()));
    host.innerHTML = `
      <span class="label">Statuses</span>
      <div class="tags">${tags.map((s) => `<span class="tag">${escapeHtml(s)}${locked ? '' : `<button type="button" data-remove="${escapeHtml(s)}">×</button>`}</span>`).join('')}</div>
      ${locked ? '' : `<input type="text" placeholder="Add status · Enter" />`}
      <div class="chips">${hints.map((s) => `<button type="button" class="chip" data-add="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>`;
    host.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const remove = (btn as HTMLElement).dataset.remove || '';
        onPatch({ statuses: tags.filter((s) => s.toLowerCase() !== remove.toLowerCase()) });
      });
    });
    host.querySelectorAll('[data-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const add = (btn as HTMLElement).dataset.add || '';
        if (!add || tags.some((s) => s.toLowerCase() === add.toLowerCase())) return;
        onPatch({ statuses: [...tags, add] });
      });
    });
    const input = host.querySelector('input');
    input?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter' && e.key !== ',') return;
      e.preventDefault();
      const add = input.value.replace(/\s+/g, ' ').trim();
      input.value = '';
      if (!add || tags.some((s) => s.toLowerCase() === add.toLowerCase())) return;
      onPatch({ statuses: [...tags, add] });
    });
    return;
  }
  if (id === 'startDates') {
    const tags = Array.isArray(criteria.startDates) ? criteria.startDates : [];
    host.innerHTML = `
      <span class="label">Start dates</span>
      <div class="tags">${tags.map((s) => `<span class="tag">${escapeHtml(formatStart(s))}${locked ? '' : `<button type="button" data-remove="${escapeHtml(s)}">×</button>`}</span>`).join('')}</div>
      ${locked ? '' : `<input type="text" placeholder="14-09-2026 · Enter" />`}`;
    host.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const remove = (btn as HTMLElement).dataset.remove || '';
        onPatch({ startDates: tags.filter((s) => s !== remove) });
      });
    });
    const input = host.querySelector('input');
    input?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter' && e.key !== ',') return;
      e.preventDefault();
      const key = parseStartInput(input.value);
      input.value = '';
      if (!key || tags.includes(key)) return;
      onPatch({ startDates: [...tags, key] });
    });
    return;
  }
  if (id === 'maxProgress') {
    const max = typeof criteria.maxProgress === 'number' ? criteria.maxProgress : null;
    host.innerHTML = `
      <div class="row-between"><span class="label">Max child progress</span><b>${max == null ? 'off' : `${max}%`}</b></div>
      <div class="chips">
        <button type="button" class="chip${max == null ? ' on' : ''}" data-prog="" ${locked ? 'disabled' : ''}>Off</button>
        <button type="button" class="chip${max === 25 ? ' on' : ''}" data-prog="25" ${locked ? 'disabled' : ''}>≤25%</button>
        <button type="button" class="chip${max === 40 ? ' on' : ''}" data-prog="40" ${locked ? 'disabled' : ''}>≤40%</button>
        <button type="button" class="chip${max === 60 ? ' on' : ''}" data-prog="60" ${locked ? 'disabled' : ''}>≤60%</button>
      </div>`;
    host.querySelectorAll('[data-prog]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = (btn as HTMLElement).dataset.prog;
        onPatch({ maxProgress: raw === '' ? null : Number(raw) });
      });
    });
    return;
  }
  if (id === 'startWithin') {
    const within = typeof criteria.startWithin === 'number' ? criteria.startWithin : null;
    host.innerHTML = `
      <div class="row-between"><span class="label">Start within</span><b>${within == null ? 'off' : `${within}d`}</b></div>
      <div class="chips">
        <button type="button" class="chip${within == null ? ' on' : ''}" data-start="" ${locked ? 'disabled' : ''}>Off</button>
        <button type="button" class="chip${within === 3 ? ' on' : ''}" data-start="3" ${locked ? 'disabled' : ''}>3d</button>
        <button type="button" class="chip${within === 7 ? ' on' : ''}" data-start="7" ${locked ? 'disabled' : ''}>7d</button>
        <button type="button" class="chip${within === 14 ? ' on' : ''}" data-start="14" ${locked ? 'disabled' : ''}>14d</button>
      </div>`;
    host.querySelectorAll('[data-start]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = (btn as HTMLElement).dataset.start;
        onPatch({ startWithin: raw === '' ? null : Number(raw) });
      });
    });
    return;
  }
  host.innerHTML = `<p class="hint">${escapeHtml(id)} is registered but has no editor yet.</p>`;
}
