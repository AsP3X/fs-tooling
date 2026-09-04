# Freshservice tooling

Ops panel for Freshservice ticket lists and Employee Onboarding / Journeys.

- Tickets: idle highlighting from **Updated**, status tags, AND/OR, saved views
- Journeys: age from status “since N days” (else created), child-ticket progress, start-date window, Internal/External counts
- Statistics snapshots do **not** store person names

## Downloads

Every push to `master` that includes `script/freshservice-mod-dialog.js` publishes a GitHub Release:

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

Current source version: **2.0.0**.
