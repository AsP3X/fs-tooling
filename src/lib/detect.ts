// Human: Decide tickets vs journeys from the forced setting, list headers, or URL.
// Agent: PURE given document/location. Auto mode looks for initiator/progress columns or onboarding paths.

import type { ModuleId, ModuleSetting } from './types';

export function detectModule(
  moduleSetting: ModuleSetting,
  doc: Document = document,
  loc: Pick<Location, 'pathname' | 'href'> = location,
): ModuleId {
  if (moduleSetting === 'tickets' || moduleSetting === 'journeys') return moduleSetting;
  const journeyHeader = doc.querySelector(
    'th[data-name="initiator"], th[data-name="child_ticket_progress"], td[data-name="child_ticket_progress"]',
  );
  const path = `${loc.pathname} ${loc.href}`;
  if (journeyHeader || /employee_onboarding|\/journeys|onboarding/i.test(path)) return 'journeys';
  return 'tickets';
}
