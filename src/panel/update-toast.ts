// Human: One-shot "update available" toast in the shadow panel. Dismiss persists until a newer GitHub release.
// Agent: CALLS fetchLatestRelease / dismissUpdate. WRITES only via the worker. Show when shouldShowUpdateNotice is true; hide immediately on Dismiss. onVisibilityChange re-clamps the host after height changes.

import { dismissUpdate, fetchLatestRelease, shouldShowUpdateNotice } from '../lib/updates';

function setVisible(toast: HTMLElement, on: boolean): void {
  toast.hidden = !on;
}

export function initUpdateToast(shadow: ShadowRoot, onVisibilityChange?: () => void): void {
  const toast = shadow.getElementById('updateToast');
  const copy = shadow.getElementById('updateToastCopy');
  const open = shadow.getElementById('updateToastOpen');
  const dismiss = shadow.getElementById('updateToastDismiss');
  if (!toast || !copy || !open || !dismiss) return;
  if (!(open instanceof HTMLAnchorElement)) return;

  let shownVersion = '';

  const reveal = (on: boolean): void => {
    setVisible(toast, on);
    onVisibilityChange?.();
  };

  void (async () => {
    const check = await fetchLatestRelease();
    if (!toast.isConnected) return;
    const release = check.release;
    if (!release) return;
    if (!shouldShowUpdateNotice({
      current: check.currentVersion,
      latest: release.version,
      dismissed: check.dismissed,
    })) return;

    shownVersion = release.version;
    copy.textContent = `Version ${release.version} is available.`;
    open.href = release.htmlUrl;
    reveal(true);
  })().catch(() => {});

  dismiss.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    reveal(false);
    void dismissUpdate(shownVersion);
  });
}
