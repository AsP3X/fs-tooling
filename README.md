# Freshservice tooling

Highlight stale tickets, filter by status, open them in tabs, and view idle/cycle statistics on Freshservice ticket lists.

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

## Add the script (once)

The injectable source is ~38KB. Add it locally so GitHub Actions can package releases:

```bash
git clone https://github.com/AsP3X/fs-tooling.git
cd fs-tooling
# copy freshservice-mod-dialog.js into script/
mkdir -p script extension
cp /path/to/freshservice-mod-dialog.js script/
git add script/freshservice-mod-dialog.js
git commit -m "Add injectable source"
git push origin master
```

The workflow on `master` then builds zip + tar.gz + the bare script and attaches them to a release tagged `v1.5.<run>`.
