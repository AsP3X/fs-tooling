# Local development

← [Back to main README](../README.md) · [Documentation index](./README.md)

## Prerequisites

- Node.js **22+** (`.nvmrc`)
- Chrome or Edge
- See also [Contributing](../CONTRIBUTING.md)

## Install and build

```bash
npm ci          # or npm install
npm run watch   # rebuilds dist/sth-extension on change
```

One-shot production package:

```bash
npm run build
```

Output:

| Path | Purpose |
|------|---------|
| `dist/sth-extension/` | Load unpacked in Chrome / Edge (`content.js` + `background.js`) |
| `dist/sth-extension.zip` | Release artifact |
| `dist/sth-extension.tar.gz` | Same folder as a tarball |
| `dist/freshservice-mod-dialog.js` | Tampermonkey / injectable script |

## Load unpacked

1. `chrome://extensions` or `edge://extensions`
2. Developer mode → **Load unpacked** → `dist/sth-extension`
3. Open a Freshservice list page
4. After a rebuild, **Reload** the extension card and refresh the tab

`extension/` is the static MV3 shell (`manifest.json`). Do not load that folder directly; it has no `content.js`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run watch` | Vite build in watch mode + re-package |
| `npm run build` | Production IIFE + icons + zip/tar/userscript |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest (jsdom) |
| `npm run check` | lint + typecheck + test + build |

## Verification matrix

| Area | Command |
|------|---------|
| Unit tests | `npm run test` |
| Lint | `npm run lint` |
| Types | `npm run typecheck` |
| Package | `npm run build` |

## Version

`package.json` `version` is the source of truth. The packager stamps it onto `manifest.json` and the userscript header. Bump it when you intend a user-visible release.
