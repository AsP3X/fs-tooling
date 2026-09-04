# Freshservice tooling

Ops panel for Freshservice ticket lists and Employee Onboarding / Journeys.

- Tickets: idle highlighting from **Updated**, status tags, AND/OR, saved views
- Journeys: injected **Start date** column parsed from the title (`Start 14-09-2026`), click the header to sort
- Also sort the visible list by Created On, Initiator, Request Status, or child progress
- Age from status “since N days” (else created), child-ticket progress, Internal/External counts
- Statistics snapshots do **not** store person names

## Downloads

Every push to `master` that includes `script/freshservice-mod-dialog.js` (or `script/parts/*.js`) publishes a GitHub Release:

- [Latest release](https://github.com/AsP3X/fs-tooling/releases/latest)
- `sth-extension.zip` — Chrome / Edge unpacked extension
- `sth-extension.tar.gz` — same folder as a tarball
- `freshservice-mod-dialog.js` — bare injectable / Tampermonkey script

## Install the extension

1. Download `sth-extension.zip` from the latest release and unpack it.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. **Load unpacked** and select the unpacked folder (`manifest.json` at the top).
5. Open `/a/tickets` or a Journeys list.

Current source version: **2.1.0**.
