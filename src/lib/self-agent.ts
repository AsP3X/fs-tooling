// Human: Numeric id of the logged-in agent. Used only to detect "assigned to me" / bounce-back.
// Agent: READS DOM, MAIN-world current_user via the worker, /api/v2/agents/me, then majority responder_id on new_and_my_open. Never keeps a name.

import { apiRequest, asRecord, asArray } from './api/http';
import { majorityAgentId } from './ops-timeline';
import { hasExtensionRuntime } from './secrets';

function positiveId(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function idFromUserHref(href: string | null | undefined): number | null {
  if (!href) return null;
  const match = href.match(/\/(?:users|agents)\/(\d+)/i);
  return match ? positiveId(match[1]) : null;
}

function idFromCurrentUserJson(text: string): number | null {
  const match = text.match(/"current_user"\s*:\s*\{[^}]{0,400}?"id"\s*:\s*(\d+)/);
  return match ? positiveId(match[1]) : null;
}

export function detectSelfAgentId(win: Window = window, doc: Document = document): number | null {
  const named = doc.querySelector('[data-current-user-id], [data-logged-in-user-id], meta[name="current-user-id"]');
  if (named) {
    const fromAttr = positiveId(named.getAttribute('content') || named.getAttribute('data-current-user-id') || named.getAttribute('data-logged-in-user-id'));
    if (fromAttr) return fromAttr;
  }
  const profile = doc.querySelector('header a[href*="/users/"], header a[href*="/agents/"], .navbar a[href*="/users/"], [data-test-id="user-menu"] a[href*="/users/"]');
  const fromProfile = idFromUserHref(profile?.getAttribute('href'));
  if (fromProfile) return fromProfile;

  const w = win as Window & { current_user?: { id?: unknown }; currentUser?: { id?: unknown } };
  const fromWindow = positiveId(w.current_user?.id ?? w.currentUser?.id);
  if (fromWindow) return fromWindow;

  const scripts = doc.querySelectorAll('script');
  for (let i = 0; i < scripts.length && i < 40; i += 1) {
    const text = scripts[i].textContent || '';
    if (!text.includes('current_user')) continue;
    const fromScript = idFromCurrentUserJson(text);
    if (fromScript) return fromScript;
  }
  return null;
}

async function agentIdFromWorker(): Promise<number | null> {
  if (!hasExtensionRuntime()) return null;
  try {
    const raw = await chrome.runtime.sendMessage({ type: 'sth.self.agentId' }) as { id?: unknown };
    return positiveId(raw?.id);
  } catch {
    return null;
  }
}

function responderIdFrom(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  return positiveId(rec.responder_id ?? rec.agent_id);
}

export async function inferSelfIdFromMyOpenTickets(): Promise<number | null> {
  const res = await apiRequest('/api/v2/tickets?filter=new_and_my_open&per_page=10');
  if (!res.ok) return null;
  const tickets = asArray(asRecord(res.json).tickets);
  const ids = tickets.map(responderIdFrom).filter((id): id is number => id != null);
  return majorityAgentId(ids);
}

export async function resolveSelfAgentId(): Promise<number | null> {
  const fromPage = detectSelfAgentId();
  if (fromPage) return fromPage;
  const fromMain = await agentIdFromWorker();
  if (fromMain) return fromMain;
  const res = await apiRequest('/api/v2/agents/me');
  if (res.ok) {
    const agent = asRecord(asRecord(res.json).agent || res.json);
    const fromMe = positiveId(agent.id);
    if (fromMe) return fromMe;
  }
  return inferSelfIdFromMyOpenTickets();
}
