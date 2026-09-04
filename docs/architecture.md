# Architecture

← [Back to main README](../README.md) · [Documentation index](./README.md)

The product is a Manifest V3 **content script** plus a small **service worker** (API key storage). Chrome and Edge load the same package.

```
src/
  content.ts            Content-script entry (host, observer)
  background.ts         Service worker — API key in chrome.storage.local
  lib/                  Pure or DOM-scrape helpers (unit-tested)
    context.ts          list / detail / other + module
    dates.ts            Ticket cell dates + journey Start-from-title
    match.ts            AND/OR idle / status / start / progress
    range.ts            Inclusive from–to keys for the results overlay
    secrets.ts          Message the worker (or sessionStorage in userscripts)
    settings.ts         localStorage merge + normalize
    rows.ts             tr.et-tr → RowItem
    sort.ts             Visible-page comparator
    stats.ts            Buckets and snapshots (no names)
    detect.ts           tickets vs journeys
    api/                Freshservice v2 client, ticket/journey enrich, range list
  page/                 Host-page mutations (highlight, start column)
  panel/                Shadow-DOM UI (html/css + event wiring)
    features.ts         Context-gated cards + registerPanelFeature()
extension/
  manifest.json         MV3 shell (version stamped at build)
```

Vite bundles `src/content.ts` as an IIFE to `dist/sth-extension/content.js`. A packager then copies the manifest, `background.js`, generates icons, wraps a userscript header, and zips the folder.

When an API key is saved, `enrichList` overlays `updated_at` / status (tickets) and custom start dates / child-ticket progress (journeys) onto visible rows, and loads off-page matches for **Open marked** and statistics (capped at 500). Without a key, the panel stays DOM-only.

A from–to **date range** (`startFrom` / `startTo`) is a separate overlay, not part of idle/status highlighting. It stays **disabled until an API key is saved**. With a key, set From / To and click **Apply** — dates are not queried on change. Tickets are listed by `updated_at`; journeys by start date (API custom field, then `Start DD-MM-YYYY` in the title). Results render in **Range results**. The live Freshservice table is never hidden, rebuilt, or de-paginated.

## Isolation

- **JavaScript world:** isolated from the Freshservice Ember app. DOM is shared.
- **UI:** floating panel lives in an open shadow root (`#sth-host`) so host CSS cannot restyle it.
- **Page CSS:** idle-row highlight and the Start date column are injected into `document.head` as `#sth-page-style`.

## Persistence

| Key | Where | Contents |
|-----|--------|----------|
| `sth-settings-v2` | Page `localStorage` | Module, panel position, per-page filters/views |
| `sth-history-v2` | Page `localStorage` | Rolling statistics snapshots (counts/averages only) |
| `sth.apiKey` | Extension `chrome.storage.local` (service worker) | Freshservice API key. Never written to page storage. |

Panel settings keys live on the **host page** origin so a Tampermonkey install and the extension share views. The API key does not: the extension keeps it in the worker; the userscript build falls back to `sessionStorage`.

## Context-based features

`detectContext` returns `{ module, surface }` (`list` | `detail` | `other`). Built-in cards in `panel.html` set `data-feature="…"` and `applyFeatureVisibility` hides anything that does not match the current page.

To add a new context-specific card without restyling the panel:

1. Implement a `PanelFeature` (`id`, `modules`, `surfaces`, `mount`, optional `sync`).
2. Call `registerPanelFeature` from a module imported by `src/content.ts`.
3. Reuse existing classes (`card`, `tagbox`, `chip`, `hint`, …). The plugin host is `#featureMount`.

## Matching

`itemMatches` in `src/lib/match.ts`:

- **OR:** idle age **or** a selected status **or** a selected start date (plus optional progress / start-within).
- **AND:** idle age **and** each *non-empty* tag list. Empty status or start-date lists are skipped, not treated as “match nothing”.
- **Date range** does not participate. It only fills the Range results overlay.

Journey start dates come from the subject (`Start` / `Starting` + day-first date) on the page, and from initiator custom fields when the API key works. Do not use Updated/Created cells for that column.

## List updates

A `MutationObserver` on `document.body` re-runs `markTickets` (debounced 300ms) when Freshservice replaces table rows. Writes to our Start date column and the panel host are ignored so they cannot retrigger paint. Highlight classes are synced in place — they are not cleared before the async API enrich returns. Re-injecting the script disconnects the previous observer and removes the old host.

## Tests

Prefer unit tests next to the module (`src/lib/*.test.ts`) with jsdom fixtures for DOM scraping. Live Freshservice pages are a manual smoke only — see [regression-testing](../.cursor/rules/regression-testing.mdc).
