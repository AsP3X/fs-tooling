// Human: Settings → About. The Check for updates button must come back after every kind of result.
// Agent: Mocks lib/updates + lib/secrets. No worker, no network.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateCheckResult } from '../lib/updates';

const fetchLatestRelease = vi.fn<(opts?: { force?: boolean }) => Promise<UpdateCheckResult>>();

vi.mock('../lib/updates', async (original) => ({
  ...(await original<typeof import('../lib/updates')>()),
  fetchLatestRelease: (opts?: { force?: boolean }) => fetchLatestRelease(opts),
  installedAddonVersion: () => '2.8.5',
}));
vi.mock('../lib/secrets', async (original) => ({
  ...(await original<typeof import('../lib/secrets')>()),
  hasExtensionRuntime: () => true,
}));

import { initAbout } from './about';

function mount(): { host: HTMLElement; shadow: ShadowRoot; button: HTMLButtonElement; status: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <span id="aboutVersion"></span><span id="aboutPublisher"></span>
    <p id="aboutUpdateStatus"></p>
    <a id="aboutReleaseLink" hidden href="#"></a>
    <button id="checkUpdates" type="button">Check for updates</button>`;
  return {
    host,
    shadow,
    button: shadow.getElementById('checkUpdates') as HTMLButtonElement,
    status: shadow.getElementById('aboutUpdateStatus') as HTMLElement,
  };
}

function result(partial: Partial<UpdateCheckResult>): UpdateCheckResult {
  return { ok: true, currentVersion: '2.8.5', release: null, dismissed: null, ...partial } as UpdateCheckResult;
}

const release = { version: '2.9.0', htmlUrl: 'https://github.com/AsP3X/fs-tooling/releases/tag/v2.9.0' };

beforeEach(() => {
  document.body.innerHTML = '';
  fetchLatestRelease.mockReset();
});

describe('Check for updates button', () => {
  it('is disabled only while the check runs', async () => {
    let finish: (value: UpdateCheckResult) => void = () => {};
    fetchLatestRelease.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { shadow, button } = mount();
    const pending = initAbout(shadow).refresh({ force: true });
    expect(button.disabled).toBe(true);
    finish(result({}));
    await pending;
    expect(button.disabled).toBe(false);
  });

  it('stays clickable when an update is available', async () => {
    fetchLatestRelease.mockResolvedValue(result({ release } as Partial<UpdateCheckResult>));
    const { shadow, button, status } = mount();
    await initAbout(shadow).refresh({ force: true });
    expect(status.textContent).toBe('Version 2.9.0 is available.');
    expect(button.disabled).toBe(false);
  });

  it('stays clickable when GitHub could not be reached', async () => {
    fetchLatestRelease.mockResolvedValue(result({ ok: false }));
    const { shadow, button, status } = mount();
    await initAbout(shadow).refresh({ force: true });
    expect(status.textContent).toContain('Couldn’t reach GitHub');
    expect(button.disabled).toBe(false);
  });

  it('stays clickable when the request throws', async () => {
    fetchLatestRelease.mockRejectedValue(new Error('boom'));
    const { shadow, button, status } = mount();
    await initAbout(shadow).refresh({ force: true });
    expect(status.textContent).toContain('Couldn’t reach GitHub');
    expect(button.disabled).toBe(false);
  });

  it('is re-enabled when the panel was removed during the check', async () => {
    let finish: (value: UpdateCheckResult) => void = () => {};
    fetchLatestRelease.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { host, shadow, button } = mount();
    const pending = initAbout(shadow).refresh({ force: true });
    host.remove();
    finish(result({}));
    await pending;
    expect(button.disabled).toBe(false);
  });

  it('runs a click made during a check once the first one ends, even after an early return', async () => {
    let finish: (value: UpdateCheckResult) => void = () => {};
    fetchLatestRelease.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    fetchLatestRelease.mockResolvedValueOnce(result({}));
    const { shadow, button, status } = mount();
    const about = initAbout(shadow);
    const first = about.refresh();
    void about.refresh({ force: true });
    finish(result({ release } as Partial<UpdateCheckResult>));
    await first;
    expect(fetchLatestRelease).toHaveBeenCalledTimes(2);
    expect(fetchLatestRelease).toHaveBeenLastCalledWith({ force: true });
    expect(status.textContent).toContain('up to date');
    expect(button.disabled).toBe(false);
  });
});
