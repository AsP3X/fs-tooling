// Human: Settings → About: installed version, publisher, manual GitHub check, release link when newer.
// Agent: CALLS installedAddonVersion / fetchLatestRelease. WRITES only toast-independent UI. isUpdateAvailable ignores dismiss so Settings still offers the release link after the toast is dismissed.

import { hasExtensionRuntime } from '../lib/secrets';
import {
  ADDON_PUBLISHER,
  fetchLatestRelease,
  installedAddonVersion,
  isUpdateAvailable,
} from '../lib/updates';

export function initAbout(shadow: ShadowRoot): { refresh: (opts?: { force?: boolean }) => Promise<void> } {
  const versionEl = shadow.getElementById('aboutVersion');
  const publisherEl = shadow.getElementById('aboutPublisher');
  const statusEl = shadow.getElementById('aboutUpdateStatus');
  const link = shadow.getElementById('aboutReleaseLink');
  const checkBtn = shadow.getElementById('checkUpdates');
  if (!versionEl || !publisherEl || !statusEl || !link || !checkBtn) {
    return { refresh: async () => {} };
  }
  if (!(link instanceof HTMLAnchorElement) || !(checkBtn instanceof HTMLButtonElement)) {
    return { refresh: async () => {} };
  }

  publisherEl.textContent = ADDON_PUBLISHER;
  versionEl.textContent = installedAddonVersion() || '—';

  const setLink = (href: string | null, version: string | null): void => {
    if (href && version) {
      link.href = href;
      link.textContent = `View ${version} release`;
      link.hidden = false;
    } else {
      link.hidden = true;
    }
  };

  let inflight = false;
  let queuedForce = false;

  // Human: One GitHub lookup. Writes the status line and release link; never touches the button.
  // Agent: CALLS fetchLatestRelease. Early returns are safe here because refresh() owns the button state.
  const runCheck = async (force: boolean): Promise<void> => {
    const check = await fetchLatestRelease({ force });
    if (!statusEl.isConnected) return;
    const current = check.currentVersion || installedAddonVersion();
    versionEl.textContent = current || '—';
    const release = check.release;
    if (release && isUpdateAvailable(current, release.version)) {
      statusEl.textContent = `Version ${release.version} is available.`;
      setLink(release.htmlUrl, release.version);
      return;
    }
    if (!check.ok) {
      statusEl.textContent = 'Couldn’t reach GitHub. Try Check for updates.';
      return;
    }
    statusEl.textContent = current ? `You’re on ${current} · up to date.` : 'Up to date.';
    setLink(null, null);
  };

  // Human: Disable the button only while a check runs. Every exit (update found, GitHub unreachable,
  // thrown request, panel removed) hands it back, so a failed check can be retried.
  // Agent: WRITES checkBtn.disabled in finally. A forced click during a check is queued and re-run once.
  const refresh = async (opts: { force?: boolean } = {}): Promise<void> => {
    if (!statusEl.isConnected) return;
    versionEl.textContent = installedAddonVersion() || '—';
    if (!hasExtensionRuntime()) {
      statusEl.textContent = 'Update checks need the Chrome / Edge addon.';
      checkBtn.disabled = true;
      setLink(null, null);
      return;
    }
    if (inflight) {
      if (opts.force) queuedForce = true;
      return;
    }
    inflight = true;
    checkBtn.disabled = true;
    if (opts.force) statusEl.textContent = 'Checking GitHub…';
    try {
      await runCheck(!!opts.force);
    } catch {
      if (statusEl.isConnected) statusEl.textContent = 'Couldn’t reach GitHub. Try again.';
    } finally {
      inflight = false;
      checkBtn.disabled = !hasExtensionRuntime();
    }
    if (queuedForce) {
      queuedForce = false;
      if (statusEl.isConnected && hasExtensionRuntime()) await refresh({ force: true });
    }
  };

  checkBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void refresh({ force: true });
  });

  return { refresh };
}
