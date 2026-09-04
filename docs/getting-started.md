# Getting started

← [Back to main README](../README.md) · [Documentation index](./README.md)

The Ops Panel is a **Manifest V3 content script** for Chromium browsers. It injects a floating panel on Freshservice ticket lists and Employee Onboarding / Journeys lists.

## Chrome or Edge (unpacked)

1. Download `sth-extension.zip` from the [latest GitHub Release](https://github.com/AsP3X/fs-tooling/releases/latest).
2. Unpack it. `manifest.json` must be in the folder you select.
3. Open `chrome://extensions` or `edge://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked** and select that folder.
6. Open `/a/tickets` or an Employee Onboarding / Journeys list.

After you edit source and rebuild, click **Reload** on the extension card, then refresh Freshservice.

## Tampermonkey / injectable script

The same bundle is published as `freshservice-mod-dialog.js` (userscript header + IIFE). Install it as a Tampermonkey script, or paste it in the browser console on a Freshservice page.

Settings are stored in the **page** `localStorage`, so the extension and userscript share views on the same origin.

## What it does

- Compact floating panel (settings sections collapsed by default)
- Tickets: idle highlighting from **Updated**, status tags, AND/OR, saved views
- Journeys: injected **Start date** column parsed from the title (`Start 14-09-2026`); click the header to sort
- Sort the visible list by Created On, Initiator, Request Status, or child progress
- Statistics snapshots do **not** store person names
