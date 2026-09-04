# Freshservice tooling

Ops panel for Freshservice ticket lists and Employee Onboarding / Journeys.

- Compact floating panel: settings sections are collapsed by default
- Tickets: idle highlighting from **Updated**, status tags, AND/OR, saved views
- Journeys: injected **Start date** column parsed from the title (`Start 14-09-2026`); click the header to sort; **Filter** or right-click the column for a from–to date range. The list is rebuilt to only those rows and pagination is dropped when they fit on one view (also in the ops panel)
- Sort the visible list by Created On, Initiator, Request Status, or child progress
- Statistics snapshots do **not** store person names

## Downloads

Every push to `master` that includes `script/freshservice-mod-dialog.js` publishes a GitHub Release:

- [Latest release](https://github.com/AsP3X/fs-tooling/releases/latest)
- `sth-extension.zip` — Chrome / Edge unpacked extension
- `sth-extension.tar.gz` — same folder as a tarball
- `freshservice-mod-dialog.js` — bare injectable / Tampermonkey script

Current source version: **2.3.2**.
