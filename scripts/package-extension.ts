// Human: After Vite emits content.js, stamp version, generate icons, write the userscript, zip/tar the unpacked folder.
// Agent: READS package.json + extension/manifest.json; WRITES dist/sth-extension/* and dist/freshservice-mod-dialog.js.

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const unpacked = join(dist, 'sth-extension');

function pngIcon(size: number, rgb: [number, number, number] = [21, 101, 192]): Buffer {
  const [r, g, b] = rgb;
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0;
    for (let x = 0; x < size; x += 1) {
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const chunk = (tag: string, data: Buffer) => {
    const tagBuf = Buffer.from(tag);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([tagBuf, data])) >>> 0);
    return Buffer.concat([len, tagBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function userscriptHeader(version: string): string {
  return `// ==UserScript==
// @name         Freshservice Ops Panel
// @namespace    sth
// @version      ${version}
// @description  Tickets + Journeys filters, highlighting, and statistics
// @match        https://*.freshservice.com/*
// @match        https://*.myfreshworks.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

`;
}

export function packageExtension(): void {
  const contentPath = join(unpacked, 'content.js');
  if (!existsSync(contentPath)) {
    throw new Error(`Vite did not emit ${contentPath}`);
  }
  mkdirSync(unpacked, { recursive: true });
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  const manifest = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8')) as { version: string };
  manifest.version = pkg.version;
  writeFileSync(join(unpacked, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  copyFileSync(join(root, 'extension/README.md'), join(unpacked, 'README.md'));
  for (const size of [16, 32, 48, 128]) {
    writeFileSync(join(unpacked, `icon${size}.png`), pngIcon(size));
  }
  const content = readFileSync(join(unpacked, 'content.js'), 'utf8');
  const userscript = `${userscriptHeader(pkg.version)}${content}`;
  writeFileSync(join(dist, 'freshservice-mod-dialog.js'), userscript);
  execSync('zip -qr sth-extension.zip sth-extension', { cwd: dist });
  execSync('tar -czf sth-extension.tar.gz sth-extension', { cwd: dist });
  console.log(`Packaged Freshservice Ops Panel ${pkg.version} → ${dist}`);
}
