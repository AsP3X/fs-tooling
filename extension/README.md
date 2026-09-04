# Unpacked extension

This folder is the **Manifest V3 shell** (`manifest.json`). The loadable package is built into `dist/sth-extension/`.

## Load in Chrome or Edge (development)

1. From the repo root: `npm install` then `npm run build` (or `npm run watch`).
2. Open `chrome://extensions` or `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select `dist/sth-extension`.
5. Open a Freshservice `/a/tickets` list or an Employee Onboarding / Journeys list.

After you change source, rebuild (watch does this automatically), click **Reload** on the extension card, then refresh Freshservice.

End-user zip installs: [Getting started](../docs/getting-started.md).
