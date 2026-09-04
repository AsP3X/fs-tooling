// Human: Pull ticket / journey numeric IDs out of Freshservice list hrefs.
// Agent: PURE. Tickets use /tickets/{id}; journeys use employee_onboarding or journeys/requests.

export type RecordKind = 'ticket' | 'journey';

export interface RecordRef {
  kind: RecordKind;
  id: number;
}

export function parseRecordRef(href: string | null | undefined): RecordRef | null {
  if (!href) return null;
  const ticket = href.match(/\/tickets\/(\d+)/i);
  if (ticket) return { kind: 'ticket', id: Number(ticket[1]) };
  const journey = href.match(/\/(?:employee_onboarding|journeys\/requests|journeys)\/(\d+)/i);
  if (journey) return { kind: 'journey', id: Number(journey[1]) };
  return null;
}

export function ticketHrefFor(origin: string, id: number, sample: string | null): string {
  if (sample && /\/tickets\/\d+/i.test(sample)) {
    return sample.replace(/\/tickets\/\d+.*/i, `/tickets/${id}`);
  }
  return `${origin}/a/tickets/${id}`;
}

export function journeyHrefFor(origin: string, id: number, sample: string | null): string {
  if (sample) {
    if (/\/employee_onboarding\/\d+/i.test(sample)) {
      return sample.replace(/\/employee_onboarding\/\d+.*/i, `/employee_onboarding/${id}`);
    }
    if (/\/journeys\/requests\/\d+/i.test(sample)) {
      return sample.replace(/\/journeys\/requests\/\d+.*/i, `/journeys/requests/${id}`);
    }
    if (/\/journeys\/\d+/i.test(sample)) {
      return sample.replace(/\/journeys\/\d+.*/i, `/journeys/${id}`);
    }
  }
  return `${origin}/a/employee_onboarding/${id}`;
}
