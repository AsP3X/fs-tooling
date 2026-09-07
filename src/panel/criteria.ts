// Human: Filter-editor fields. Each registered criterion id gets a compact Off row that expands when on.
// Agent: READS collectRows for status/initiator hints. CALLS onPatch with a criteria slice. Does not persist.

import { formatStart, parseStartInput } from '../lib/dates';
import { asFiniteNumber, asNumberList, asStringList, criterionActive } from '../lib/filters';
import { collectRows } from '../lib/rows';
import { PRIORITIES } from '../lib/ticket-fields';
import { escapeHtml } from '../lib/text';
import type { FilterCriteria, ModuleId } from '../lib/types';

export function groupSummary(ids: string[], criteria: FilterCriteria): string {
  const bits: string[] = [];
  ids.forEach((id) => {
    if (!criterionActive(id, criteria)) return;
    const label = summaryFor(id, criteria);
    if (label) bits.push(label);
  });
  return bits.join(' · ') || 'Off';
}

function summaryFor(id: string, c: FilterCriteria): string {
  if (id === 'idleDays') return boundLabel('Idle', c.idleDays, c.idleDaysMax);
  if (id === 'createdDays') return boundLabel('Created', c.createdDays, c.createdDaysMax);
  if (id === 'statuses') return asStringList(c.statuses).slice(0, 2).join(', ') || 'Status';
  if (id === 'excludeStatuses') {
    const n = asStringList(c.excludeStatuses).length;
    return n ? `Not ${n}` : '';
  }
  if (id === 'kinds') return asStringList(c.kinds).join(', ');
  if (id === 'initiators') return asStringList(c.initiators).slice(0, 2).join(', ');
  if (id === 'unassigned') return 'Unassigned';
  if (id === 'priorities') {
    return asNumberList(c.priorities)
      .map((n) => PRIORITIES.find((p) => p.id === n)?.label || String(n))
      .join(', ');
  }
  if (id === 'dueWithin') {
    const d = asFiniteNumber(c.dueWithin);
    if (d == null) return '';
    return d <= 0 ? 'Overdue' : `Due ≤${d}d`;
  }
  if (id === 'escalated') return 'Escalated';
  if (id === 'startDates') return `${asStringList(c.startDates).length} dates`;
  if (id === 'startWithin') {
    if (c.startPassed === true) return 'Started';
    const w = asFiniteNumber(c.startWithin);
    return w != null ? `Start ≤${w}d` : '';
  }
  if (id === 'maxProgress') return boundLabel('Prog', c.minProgress, c.maxProgress, '%');
  if (id === 'subjectIncludes') return asStringList(c.subjectIncludes).slice(0, 2).join(', ');
  return '';
}

function boundLabel(prefix: string, min: unknown, max: unknown, suffix = 'd'): string {
  const lo = asFiniteNumber(min);
  const hi = asFiniteNumber(max);
  if (lo != null && hi != null) return `${prefix} ${lo}–${hi}${suffix}`;
  if (lo != null) return `${prefix} ≥${lo}${suffix}`;
  if (hi != null) return `${prefix} ≤${hi}${suffix}`;
  return '';
}

export function mountCriterion(
  host: HTMLElement,
  id: string,
  criteria: FilterCriteria,
  moduleId: ModuleId,
  onPatch: (patch: FilterCriteria) => void,
): void {
  if (id === 'idleDays') {
    mountBound(host, 'Idle age', 'idleDays', 'idleDaysMax', criteria.idleDays, criteria.idleDaysMax, 6, 14, 'd', onPatch);
    return;
  }
  if (id === 'createdDays') {
    mountBound(host, 'Created age', 'createdDays', 'createdDaysMax', criteria.createdDays, criteria.createdDaysMax, 14, 30, 'd', onPatch);
    return;
  }
  if (id === 'statuses') {
    mountTags(host, 'Include', 'Add status · Enter', asStringList(criteria.statuses), statusHints(asStringList(criteria.statuses)), (next) => onPatch({ statuses: next }));
    return;
  }
  if (id === 'excludeStatuses') {
    mountTags(host, 'Exclude', 'Exclude status · Enter', asStringList(criteria.excludeStatuses), statusHints(asStringList(criteria.excludeStatuses)), (next) => onPatch({ excludeStatuses: next }));
    return;
  }
  if (id === 'kinds') {
    mountChoiceChips(host, 'Employee kind', [
      { value: 'Internal', label: 'Internal' },
      { value: 'External', label: 'External' },
    ], asStringList(criteria.kinds), (next) => onPatch({ kinds: next }));
    return;
  }
  if (id === 'initiators') {
    const selected = asStringList(criteria.initiators);
    const label = moduleId === 'tickets' ? 'Requester' : 'Initiator';
    mountTags(host, label, `${label} · Enter`, selected, initiatorHints(selected), (next) => onPatch({ initiators: next }));
    return;
  }
  if (id === 'unassigned') {
    mountFlag(host, 'Unassigned', criteria.unassigned === true, 'On', (on) => onPatch({ unassigned: on ? true : null }));
    return;
  }
  if (id === 'priorities') {
    const selected = asNumberList(criteria.priorities);
    host.innerHTML = `<span class="label">Priority</span><div class="chips"></div>`;
    const chips = host.querySelector('.chips') as HTMLElement;
    const off = document.createElement('button');
    off.type = 'button';
    off.className = `chip${selected.length ? '' : ' on'}`;
    off.textContent = 'Off';
    off.addEventListener('click', () => onPatch({ priorities: [] }));
    chips.appendChild(off);
    PRIORITIES.forEach((p) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chip${selected.includes(p.id) ? ' on' : ''}`;
      btn.textContent = p.label;
      btn.addEventListener('click', () => {
        const next = selected.includes(p.id) ? selected.filter((n) => n !== p.id) : [...selected, p.id];
        onPatch({ priorities: next });
      });
      chips.appendChild(btn);
    });
    return;
  }
  if (id === 'dueWithin') {
    const within = asFiniteNumber(criteria.dueWithin);
    mountExclusiveChips(host, 'Due', [
      { value: '', label: 'Off' },
      { value: '0', label: 'Overdue' },
      { value: '3', label: '3d' },
      { value: '7', label: '7d' },
      { value: '14', label: '14d' },
    ], within == null ? '' : String(within), (raw) => {
      onPatch({ dueWithin: raw === '' ? null : Number(raw) });
    });
    return;
  }
  if (id === 'escalated') {
    mountFlag(host, 'Escalated', criteria.escalated === true, 'On', (on) => onPatch({ escalated: on ? true : null }));
    return;
  }
  if (id === 'startDates') {
    const tags = asStringList(criteria.startDates);
    host.innerHTML = `
      <span class="label">Start dates</span>
      <div class="tags">${tags.map((s) => `<span class="tag">${escapeHtml(formatStart(s))}<button type="button" data-remove="${escapeHtml(s)}">×</button></span>`).join('')}</div>
      <input type="text" placeholder="14-09-2026 · Enter" />`;
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
  if (id === 'startWithin') {
    const started = criteria.startPassed === true;
    const within = asFiniteNumber(criteria.startWithin);
    const current = started ? 'started' : within == null ? '' : String(within);
    mountExclusiveChips(host, 'Start', [
      { value: '', label: 'Off' },
      { value: 'started', label: 'Started' },
      { value: '3', label: '3d' },
      { value: '7', label: '7d' },
      { value: '14', label: '14d' },
    ], current, (raw) => {
      if (raw === 'started') onPatch({ startPassed: true, startWithin: null });
      else if (raw === '') onPatch({ startPassed: null, startWithin: null });
      else onPatch({ startPassed: null, startWithin: Number(raw) });
    });
    return;
  }
  if (id === 'maxProgress') {
    mountProgress(host, criteria, onPatch);
    return;
  }
  if (id === 'subjectIncludes') {
    mountTags(host, 'Subject contains', 'Phrase · Enter', asStringList(criteria.subjectIncludes), [], (next) => onPatch({ subjectIncludes: next }));
    return;
  }
  host.innerHTML = `<p class="hint">${escapeHtml(id)} is registered but has no editor yet.</p>`;
}

function statusHints(selected: string[]): string[] {
  return [...new Set(collectRows().map((r) => r.status).filter((s) => s && s !== '—'))]
    .filter((s) => !selected.some((t) => t.toLowerCase() === s.toLowerCase()));
}

function initiatorHints(selected: string[]): string[] {
  return [...new Set(collectRows().map((r) => r.initiator).filter(Boolean))]
    .filter((s) => !selected.some((t) => t.toLowerCase() === s.toLowerCase()));
}

function mountBound(
  host: HTMLElement,
  label: string,
  minKey: string,
  maxKey: string,
  minRaw: unknown,
  maxRaw: unknown,
  defaultMin: number,
  defaultMax: number,
  suffix: string,
  onPatch: (patch: FilterCriteria) => void,
): void {
  const min = asFiniteNumber(minRaw);
  const max = asFiniteNumber(maxRaw);
  const minShown = min ?? defaultMin;
  const maxShown = max ?? defaultMax;
  host.innerHTML = `
    <span class="label">${escapeHtml(label)}</span>
    <div class="editor-bound">
      <div class="row-between"><span class="hint">At least</span>
        <button type="button" class="chip${min != null ? ' on' : ''}" data-bound="min">${min != null ? `${minShown}${suffix}` : 'Off'}</button>
      </div>
      <input type="range" data-range="min" min="1" max="45" step="1" value="${minShown}" ${min == null ? 'hidden' : ''} />
      <div class="row-between"><span class="hint">At most</span>
        <button type="button" class="chip${max != null ? ' on' : ''}" data-bound="max">${max != null ? `${maxShown}${suffix}` : 'Off'}</button>
      </div>
      <input type="range" data-range="max" min="1" max="45" step="1" value="${maxShown}" ${max == null ? 'hidden' : ''} />
    </div>`;
  const minChip = host.querySelector('[data-bound="min"]') as HTMLButtonElement;
  const maxChip = host.querySelector('[data-bound="max"]') as HTMLButtonElement;
  const minRange = host.querySelector('[data-range="min"]') as HTMLInputElement;
  const maxRange = host.querySelector('[data-range="max"]') as HTMLInputElement;
  minChip.addEventListener('click', () => onPatch({ [minKey]: min == null ? minShown : null }));
  maxChip.addEventListener('click', () => onPatch({ [maxKey]: max == null ? maxShown : null }));
  minRange.addEventListener('input', () => { minChip.textContent = `${minRange.value}${suffix}`; });
  maxRange.addEventListener('input', () => { maxChip.textContent = `${maxRange.value}${suffix}`; });
  minRange.addEventListener('change', () => onPatch({ [minKey]: Number(minRange.value) }));
  maxRange.addEventListener('change', () => onPatch({ [maxKey]: Number(maxRange.value) }));
}

function mountProgress(host: HTMLElement, criteria: FilterCriteria, onPatch: (patch: FilterCriteria) => void): void {
  const min = asFiniteNumber(criteria.minProgress);
  const max = asFiniteNumber(criteria.maxProgress);
  host.innerHTML = `
    <span class="label">Child progress</span>
    <div class="row-between"><span class="hint">At least</span>
      <div class="chips" data-prog="min">
        <button type="button" class="chip${min == null ? ' on' : ''}" data-val="">Off</button>
        <button type="button" class="chip${min === 25 ? ' on' : ''}" data-val="25">≥25%</button>
        <button type="button" class="chip${min === 40 ? ' on' : ''}" data-val="40">≥40%</button>
        <button type="button" class="chip${min === 60 ? ' on' : ''}" data-val="60">≥60%</button>
      </div>
    </div>
    <div class="row-between"><span class="hint">At most</span>
      <div class="chips" data-prog="max">
        <button type="button" class="chip${max == null ? ' on' : ''}" data-val="">Off</button>
        <button type="button" class="chip${max === 25 ? ' on' : ''}" data-val="25">≤25%</button>
        <button type="button" class="chip${max === 40 ? ' on' : ''}" data-val="40">≤40%</button>
        <button type="button" class="chip${max === 60 ? ' on' : ''}" data-val="60">≤60%</button>
      </div>
    </div>`;
  host.querySelectorAll('[data-prog="min"] [data-val]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const raw = (btn as HTMLElement).dataset.val || '';
      onPatch({ minProgress: raw === '' ? null : Number(raw) });
    });
  });
  host.querySelectorAll('[data-prog="max"] [data-val]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const raw = (btn as HTMLElement).dataset.val || '';
      onPatch({ maxProgress: raw === '' ? null : Number(raw) });
    });
  });
}

function mountFlag(host: HTMLElement, label: string, on: boolean, onLabel: string, onToggle: (next: boolean) => void): void {
  host.innerHTML = `
    <div class="row-between"><span class="label">${escapeHtml(label)}</span>
      <button type="button" class="chip${on ? ' on' : ''}">${on ? onLabel : 'Off'}</button>
    </div>`;
  host.querySelector('button')?.addEventListener('click', () => onToggle(!on));
}

function mountExclusiveChips(
  host: HTMLElement,
  label: string,
  options: Array<{ value: string; label: string }>,
  current: string,
  onPick: (value: string) => void,
): void {
  host.innerHTML = `<span class="label">${escapeHtml(label)}</span><div class="chips"></div>`;
  const chips = host.querySelector('.chips') as HTMLElement;
  options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip${opt.value === current ? ' on' : ''}`;
    btn.textContent = opt.label;
    btn.addEventListener('click', () => onPick(opt.value === current && opt.value !== '' ? '' : opt.value));
    chips.appendChild(btn);
  });
}

function mountChoiceChips(
  host: HTMLElement,
  label: string,
  options: Array<{ value: string; label: string }>,
  selected: string[],
  onChange: (next: string[]) => void,
): void {
  host.innerHTML = `<span class="label">${escapeHtml(label)}</span><div class="chips"></div>`;
  const chips = host.querySelector('.chips') as HTMLElement;
  options.forEach((opt) => {
    const on = selected.some((s) => s.toLowerCase() === opt.value.toLowerCase());
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip${on ? ' on' : ''}`;
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      const next = on
        ? selected.filter((s) => s.toLowerCase() !== opt.value.toLowerCase())
        : [...selected, opt.value];
      onChange(next);
    });
    chips.appendChild(btn);
  });
}

function mountTags(
  host: HTMLElement,
  label: string,
  placeholder: string,
  tags: string[],
  hints: string[],
  onChange: (next: string[]) => void,
): void {
  host.innerHTML = `
    <span class="label">${escapeHtml(label)}</span>
    <div class="tags">${tags.map((s) => `<span class="tag">${escapeHtml(s)}<button type="button" data-remove="${escapeHtml(s)}">×</button></span>`).join('')}</div>
    <input type="text" placeholder="${escapeHtml(placeholder)}" />
    <div class="chips">${hints.slice(0, 8).map((s) => `<button type="button" class="chip" data-add="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>`;
  host.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const remove = (btn as HTMLElement).dataset.remove || '';
      onChange(tags.filter((s) => s.toLowerCase() !== remove.toLowerCase()));
    });
  });
  host.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const add = (btn as HTMLElement).dataset.add || '';
      if (!add || tags.some((s) => s.toLowerCase() === add.toLowerCase())) return;
      onChange([...tags, add]);
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
    onChange([...tags, add]);
  });
}
