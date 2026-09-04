// Human: Page context for the ops panel — which product module and which surface (list vs detail).
// Agent: PURE. detectContext drives feature visibility; keep URL heuristics in sync with detectModule.

import type { ModuleId, ModuleSetting } from './types';
import { detectModule } from './detect';

export type Surface = 'list' | 'detail' | 'other';
export type ContextModule = ModuleId | 'unknown';

export interface AppContext {
  module: ContextModule;
  surface: Surface;
  path: string;
}

export function detectSurface(
  doc: Document = document,
  loc: Pick<Location, 'pathname' | 'href'> = location,
): Surface {
  const path = `${loc.pathname} ${loc.href}`;
  if (doc.querySelector('tr.et-tr')) return 'list';
  if (/\/tickets\/\d+/.test(path)) return 'detail';
  if (/\/(?:employee_onboarding|journeys)\/(?:requests\/)?\d+/.test(path)) return 'detail';
  return 'other';
}

export function detectContext(
  moduleSetting: ModuleSetting,
  doc: Document = document,
  loc: Pick<Location, 'pathname' | 'href'> = location,
): AppContext {
  return {
    module: detectModule(moduleSetting, doc, loc),
    surface: detectSurface(doc, loc),
    path: loc.pathname,
  };
}

export function contextLabel(ctx: AppContext): { title: string; sub: string } {
  if (ctx.surface === 'list') {
    const name = ctx.module === 'journeys' ? 'Journeys' : 'Tickets';
    return { title: name, sub: name };
  }
  if (ctx.surface === 'detail') {
    return {
      title: 'Ops panel',
      sub: ctx.module === 'journeys' ? 'Journey request' : 'Ticket view',
    };
  }
  return { title: 'Ops panel', sub: 'No list on this page' };
}
