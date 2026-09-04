# Freshservice Ops Panel

Chrome / Edge Manifest V3 content script for Freshservice ticket lists and Employee Onboarding / Journeys.

**Documentation hub:** [`docs/README.md`](docs/README.md)

---

## Quick start

**Use the extension**

1. Grab `sth-extension.zip` from the [latest release](https://github.com/AsP3X/fs-tooling/releases/latest).
2. Load it unpacked in Chrome or Edge — [Getting started](docs/getting-started.md).

**Hack on it**

```bash
git clone https://github.com/AsP3X/fs-tooling.git
cd fs-tooling
npm ci
npm run watch
```

Load unpacked from `dist/sth-extension/`. Full loop: [Local development](docs/local-development.md).

---

## What it does

- Compact floating panel: settings sections are collapsed by default
- Tickets: idle highlighting from **Updated**, status tags, AND/OR, saved views
- Journeys: injected **Start date** column parsed from the title (`Start 14-09-2026`); click the header to sort
- Sort the visible list by Created On, Initiator, Request Status, or child progress
- Statistics snapshots do **not** store person names

Current version: **2.4.0** (`package.json`).

---

## Downloads

Every push to `master` publishes a GitHub Release:

- [Latest release](https://github.com/AsP3X/fs-tooling/releases/latest)
- `sth-extension.zip` — Chrome / Edge unpacked extension
- `sth-extension.tar.gz` — same folder as a tarball
- `freshservice-mod-dialog.js` — Tampermonkey / injectable script

---

## Project structure

```
.
├── src/                  TypeScript content script (lib, page, panel)
├── extension/            MV3 manifest shell
├── scripts/              Build / packager
├── docs/                 Guides (start at docs/README.md)
├── CONTRIBUTING.md       Branch flow and PR checks
└── .cursor/rules/        Agent + contributor conventions
```

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for branch flow (`feature/*` → `dev` → `master`), CI commands, and commit prefixes.

Local loop: [Local development](docs/local-development.md) · architecture: [Architecture](docs/architecture.md).
