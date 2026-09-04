// Human: Context-gated feature registry. Built-in panel cards use data-feature; plugins mount into #featureMount.
// Agent: READS AppContext; WRITES hidden on [data-feature] nodes. registerPanelFeature is the extension point for new cards.

import type { AppContext, Surface } from '../lib/context';
import type { ModuleId } from '../lib/types';

export type FeatureModule = ModuleId | 'global';

export interface FeatureSpec {
  id: string;
  modules: FeatureModule[];
  surfaces: Surface[];
}

export interface PanelFeature extends FeatureSpec {
  mount(host: HTMLElement, ctx: AppContext): void;
  sync?(host: HTMLElement, ctx: AppContext): void;
}

/** Built-in cards already in panel.html. New work should registerPanelFeature instead of growing ui.ts. */
export const BUILTIN_FEATURES: FeatureSpec[] = [
  { id: 'list-chrome', modules: ['tickets', 'journeys'], surfaces: ['list'] },
  { id: 'list-age', modules: ['tickets', 'journeys'], surfaces: ['list'] },
  { id: 'list-match', modules: ['tickets', 'journeys'], surfaces: ['list'] },
  { id: 'extra', modules: ['journeys'], surfaces: ['list'] },
  { id: 'list-sort', modules: ['tickets', 'journeys'], surfaces: ['list'] },
  { id: 'list-status', modules: ['tickets', 'journeys'], surfaces: ['list'] },
  { id: 'start', modules: ['journeys'], surfaces: ['list'] },
  { id: 'list-color', modules: ['tickets', 'journeys'], surfaces: ['list'] },
  { id: 'list-foot', modules: ['tickets', 'journeys'], surfaces: ['list'] },
  { id: 'empty-hint', modules: ['global'], surfaces: ['detail', 'other'] },
];

const plugins: PanelFeature[] = [];

export function registerPanelFeature(feature: PanelFeature): void {
  const i = plugins.findIndex((p) => p.id === feature.id);
  if (i >= 0) plugins[i] = feature;
  else plugins.push(feature);
}

export function registeredFeatures(): readonly PanelFeature[] {
  return plugins;
}

export function featureVisible(spec: FeatureSpec, ctx: AppContext): boolean {
  const moduleOk = spec.modules.includes('global')
    || (ctx.module !== 'unknown' && spec.modules.includes(ctx.module));
  return moduleOk && spec.surfaces.includes(ctx.surface);
}

export function applyFeatureVisibility(root: ParentNode, ctx: AppContext): void {
  const specs = new Map(BUILTIN_FEATURES.map((s) => [s.id, s]));
  plugins.forEach((p) => specs.set(p.id, p));
  root.querySelectorAll<HTMLElement>('[data-feature]').forEach((el) => {
    const id = el.dataset.feature || '';
    const spec = specs.get(id);
    if (!spec) {
      el.hidden = false;
      return;
    }
    el.hidden = !featureVisible(spec, ctx);
  });
}

export function syncRegisteredFeatures(mount: HTMLElement, ctx: AppContext): void {
  plugins.forEach((feature) => {
    let host = mount.querySelector<HTMLElement>(`[data-plugin="${feature.id}"]`);
    if (!host) {
      host = document.createElement('div');
      host.dataset.plugin = feature.id;
      host.dataset.feature = feature.id;
      mount.appendChild(host);
      feature.mount(host, ctx);
    }
    host.hidden = !featureVisible(feature, ctx);
    if (!host.hidden) feature.sync?.(host, ctx);
  });
}
