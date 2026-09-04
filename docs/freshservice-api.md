# Freshservice REST API

← [Back to main README](../README.md) · [Documentation index](./README.md)

How this extension would talk to Freshservice for features that need more than the visible HTML table.

**Primary reference:** [Service Desk API for Developers](https://api.freshservice.com/) (`https://api.freshservice.com/`, Authentication section).

## Auth: login vs API key

A colleague’s claim that “it requires user login and an API key” is **half right**.

| Credential | Required for API calls? | Notes |
|------------|-------------------------|--------|
| Agent login to the portal | **To obtain** the key, yes | Profile Settings is behind a logged-in agent session. |
| Personal **API key** | **Yes** — this is the API credential | HTTP Basic Auth. The key inherits that agent’s role permissions. |
| Username + password on each request | **No** (removed) | Deprecated **31 May 2023**. Requests using email/password Basic Auth fail with **401**. |
| Browser session cookies alone | **Not documented** for `/api/v2` | Product cookies (`helpdesk_node_session`, `_itildesk_session`, `fw-session-id`, FreshId `_d` / `XSRF-TOKEN`, …) identify the web user. They are not listed as `/api/v2` credentials. Do not build on cookie-only calls. |
| OAuth 2.0 Bearer token | Optional, since April 2024 | Aimed at Freshworks marketplace / FreshID apps, not the default path. |

Official wording ([api.freshservice.com — Authentication](https://api.freshservice.com/#authentication)):

> Before you can … use any of the APIs … you need to “authenticate your ID” or “log in” in the same way you log in to your helpdesk’s web portal.
>
> You can use your personal API key to authenticate the request. If you use the API key, there is no need for a password. You can use any set of characters as a dummy password.
>
> Freshservice … supports Basic Access Authorization **only with API key**.
>
> Username/password basic authentication is deprecated as of May 31st 2023.

The “log in” sentence is analogical: you identify as an agent. The actual request credential is the **API key**, not the portal password. Microsoft’s connector documents the same: username/password auth is no longer supported; API key only ([learn.microsoft.com/connectors/freshservice](https://learn.microsoft.com/en-us/connectors/freshservice/)).

Deprecation source: [Freshservice migration items — Nov 2022](https://support.freshservice.com/support/solutions/articles/50000005520-freshservice-list-of-migration-items-november-2022) and [developer community announcement](https://community.freshworks.dev/t/deprecation-of-basic-authentication-username-password-based-for-freshservice-api-v2/8053).

### How to get the key

From the official API docs and [Where do I find my API key?](https://support.freshservice.com/support/solutions/articles/50000000306-freshservice-apis):

1. Log in to the Freshservice portal as an **agent**.
2. Profile picture (top right) → **Profile settings**.
3. Copy the API key (right side, below Change Password / Delegate Approvals).

If the key is missing or “disabled”, an Account Admin may need to enable API key access on that agent (community: Global Settings → Agents → agent profile → Permissions). Some tenants restrict keys at Admin → Security.

The key is **per agent**. API access is limited to what that agent’s role can do in the UI ([api.freshservice.com — “Will everyone have the same access rights?”](https://api.freshservice.com/#authentication)).

### Request format

Base URL is the tenant host, **not** a custom CNAME. HTTPS only. JSON only for v2.

```bash
curl -v -u "$API_KEY:X" \
  -H "Content-Type: application/json" \
  -X GET "https://YOUR_DOMAIN.freshservice.com/api/v2/tickets"
```

Equivalent header: `Authorization: Basic` + Base64(`API_KEY` + `:X`). The password part can be any dummy string; docs use `X`.

HTTP **401** Authentication Failure covers a missing/wrong header (`invalid_credentials`), leftover email/password Basic Auth (`unsupported_authentication_type`), and bad OAuth tokens (`access_token_expired`, `access_token_invalid`).

### OAuth 2.0 (optional, heavier)

Since April 2024, Freshservice APIs also accept OAuth via FreshID. Each endpoint lists an **OAuth 2.0 Scope** (for example `freshservice.tickets.view`). This is for apps registered in the [Freshworks Developer Portal](https://developers.freshworks.com/) ([announcement](https://community.freshworks.dev/t/freshworks-introduces-multi-oauth-functionality-for-app-developers-and-oauth-support-for-freshservice-apis/12798)).

- Access token lifetime **30 minutes**; refresh token **365 days**.
- Authorize: `https://ORG.myfreshworks.com/org/oauth/v2/authorize`
- Token: `https://ORG.myfreshworks.com/org/oauth/v2/token`
- Call APIs with `Authorization: Bearer <access_token>`.

For this Chrome/Edge unpacked extension, **personal API keys are the documented, simple path**. OAuth is the better long-term fit if we ever ship as a Freshworks marketplace app (scoped consent, no long-lived key in the browser).

## Calling from this extension

Chrome’s own guidance is to keep secrets and privileged network work in the **service worker**, not in a content script (content scripts share a renderer with the page). Freshworks marketplace apps have the same shape: never put API keys in front-end code.

Do **not**:

- Store the key in page `localStorage` (`sth-settings-v2`) — the host page can read it.
- Put the key in the content script, or in `chrome.storage.local` / `sync` without restricting access — those stores are visible to content scripts by default.

Do:

- Collect the key in the panel **Settings** view (gear in the header).
- Persist it via the service worker in `chrome.storage.local` (`sth.apiKey`). The content script only messages the worker; it does not write the key to page `localStorage`.
- Have future `/api/v2` calls run in the **service worker** with `Authorization`, not in the content script.
- `"storage"` and `host_permissions` for `https://*.freshservice.com/*` are declared in the manifest.

Same-origin `fetch` from the content script *can* send a Basic Auth header, but that puts the key in the page’s JS world. Prefer the worker. Runtime of cookie-only same-origin `/api/v2` was not tested and is not documented.

## Endpoints that match this panel

Tickets:

| Action | Method | Path |
|--------|--------|------|
| List | GET | `/api/v2/tickets` (`page`, `per_page`, `updated_since`, `filter`, `requester_id`, …) |
| Filter query | GET | `/api/v2/tickets/filter?query="status:2 AND priority:3"` |
| View one | GET | `/api/v2/tickets/{id}` (`include=requester,conversations,stats,…`) |
| Update | PUT | `/api/v2/tickets/{id}` |

Journeys / onboarding (the Journeys list in the UI):

| Action | Method | Path |
|--------|--------|------|
| List journey requests | GET | `/api/v2/journeys/requests` |
| Filter | POST | `/api/v2/journeys/requests/view` |
| View one | GET | `/api/v2/journeys/requests/{id}` |
| Update | PATCH | `/api/v2/journeys/requests/{id}` |
| Cancel | PUT | `/api/v2/journeys/requests/{id}/cancel` |
| Activities | GET | `/api/v2/journeys/requests/{id}/activities` |
| Legacy onboarding list | GET | `/api/v2/onboarding_requests` |
| Child tickets of an onboarding request | GET | `/api/v2/onboarding_requests/{id}/tickets` |

Default page size is **30**, max **`per_page=100`**. Use the `Link` response header for the next page. Avoid deep page numbers over **500**.

## Rate limits

Account-wide, per **minute** (accounts created on/after 1 Sep 2020), not per agent or IP. Freshservice for Business Teams (Pro) and Freshservice for MSPs (Core) use the Growth figures for Overall / Ticket / Agent / Requester.

| | Starter | Growth | Pro | Enterprise | Add-on 1 | Add-on 2 |
|--|---------|--------|-----|------------|----------|----------|
| Overall / min | 100 | 200 | 400 | 500 | 1000 | 2000 |
| List all tickets / min | 40 | 70 | 120 | 140 | 180 | 480 |
| View / create / update ticket / min | 50 | 80 | 140 | 160 | 300 | 600 |

Add-on packs are paid Pro/Enterprise extras. Headers: `X-RateLimit-Total`, `X-RateLimit-Remaining`, `X-RateLimit-Used-CurrentRequest`. HTTP **429** includes `Retry-After`. Invalid requests still count. Embedding costs extra credits (1 on SHOW, 2–3 on LIST). Journey-request APIs have no published per-operation sublimit; they fall under the overall minute cap unless Freshservice applies an unpublished one.

Note: the headers table still describes `X-RateLimit-Total` as “per hour” while v2 limits for post-2020 accounts are specified per minute. The docs do not reconcile that wording.

A list-wide “scan every ticket, not just this HTML page” feature must queue and respect those sublimits.

## What this means for advanced panel features

The current panel only sees **the rendered page**. The API can:

- Filter tickets server-side (`/api/v2/tickets/filter`) instead of AND/OR on the visible rows
- Read `updated_at` / status without scraping date cells
- Load journey request fields and child tickets without parsing the title
- Open or update tickets the agent is allowed to touch

It cannot bypass the agent’s role. A “Newbie Agent” key cannot do more than that role allows in the UI.
