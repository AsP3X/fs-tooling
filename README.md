# Freshservice tooling

Highlight stale tickets, filter by status (AND/OR), save views, open marked tickets in tabs, and view idle/cycle statistics on Freshservice ticket lists.

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
5. Open `/a/tickets`.

## Views and match mode (1.6.0)

- **All** — mark only if idle **and** (optional) status is listed
- **Any** — mark if idle **or** status is listed
- Built-in views: Idle 6d, Open + idle, Pending 3d, 3rd party
- **Save view** stores the current days + statuses + match mode
