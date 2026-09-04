# Contributing to Freshservice Ops Panel

← [Back to main README](./README.md) · [Documentation index](./docs/README.md)

Thank you for improving the extension. This document summarizes how to work in the repo safely.

## Prerequisites

- **Node.js 22+** (see `.nvmrc`)
- Chrome or Edge (for loading the unpacked extension)
- Access to a Freshservice tenant if you are smoke-testing against a live list

## Branch flow

1. Branch from up-to-date `dev`: `feature/<short-name>`
2. Open a pull request into `dev`
3. Release line merges `dev` → `master`

If `dev` does not exist yet in your clone, create it from `master` once and use it as the integration branch.

## Local verification

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
```

Or in one step: `npm run check`.

CI runs the same checks on pull requests (see `.github/workflows/ci.yml`).

Load the unpacked build from `dist/sth-extension/` — details in [Local development](docs/local-development.md).

## Generated artifacts (do not commit)

These paths are local build output and are listed in `.gitignore`. They must not appear in `git ls-files`:

| Path | Source |
|------|--------|
| `dist/` | Vite + packager output (`content.js`, zip, userscript) |
| `node_modules/` | npm install |

After clone or a local build, `git status` should stay clean for these directories.

## Commits

Use prefixes: `TASK:`, `FIX:`, `BUGFIX:`, `DOCS:`, or `CHORE:`.

## Behavior contracts

- Settings and statistics snapshots stay in the **page** `localStorage` keys `sth-settings-v2` and `sth-history-v2` so existing users keep their views.
- Journey start dates are parsed from the **title** (`Start DD-MM-YYYY`), not from other date columns.
- Statistics snapshots must **not** store person names.
- Matching AND/OR semantics: empty status or start-date tag lists are ignored in AND mode (they do not require a match).

## Data safety

Do not scrape or export live ticket contents into the repo (fixtures only). Do not commit tenant URLs, API keys, or session cookies.
