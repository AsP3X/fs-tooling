# Freshservice Stale Tickets — unpacked extension

Manifest V3 content script. It injects the panel on Freshservice / Freshworks ticket pages and survives reloads.

## Load in Chrome or Edge

1. Unpack `sth-extension.zip` from the latest GitHub Release. `manifest.json` must be in the folder you select.
2. Open `chrome://extensions` or `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this folder.
5. Open `/a/tickets`.

After you edit `content.js`, click **Reload** on the extension card, then refresh Freshservice.
