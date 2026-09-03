# Freshservice tooling

Highlight stale tickets, filter by status, open them in tabs, and view idle/cycle statistics on Freshservice ticket lists.

## Downloads

Every push to `master` publishes a GitHub Release:

- [Latest release](https://github.com/AsP3X/fs-tooling/releases/latest)
- `sth-extension.zip` — Chrome / Edge unpacked extension
- `sth-extension.tar.gz` — same folder as a tarball
- `freshservice-mod-dialog.js` — bare injectable / Tampermonkey script

## Install the extension

1. Download `sth-extension.zip` from the latest release and unpack it.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. **Load unpacked** and select the unpacked folder (`manifest.json` at the top).
5. Open `/a/tickets`.

## Bare script

Paste `freshservice-mod-dialog.js` into the DevTools console or a Tampermonkey userscript. Settings stay in `localStorage` (`sth-settings`, `sth-history`).

## Repo layout

```
script/freshservice-mod-dialog.js   injectable source
extension/                         MV3 content-script package
scripts/build.sh                   local packager
.github/workflows/release.yml      zip + tar.gz + release assets
```
