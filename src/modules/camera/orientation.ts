let _orientationLocked = false;
let _resizeTimer: ReturnType<typeof setTimeout> | null = null;

export function updateViewportHeight(): void {
  const vh = window.innerHeight;
  document.documentElement.style.setProperty('--app-vh', `${vh}px`);
}

export function tryLockOrientation(): void {
  try {
    const screenOrientation = screen.orientation as unknown as { lock?: (orientation: string) => Promise<void> };
    if (screenOrientation && screenOrientation.lock) {
      const isLandscape = window.innerWidth > window.innerHeight;
      screenOrientation
        .lock(isLandscape ? 'landscape' : 'portrait')
        .then(() => {
          _orientationLocked = true;
        })
        .catch(() => {});
    }
  } catch {
    // Not supported
  }
}

export function unlockOrientation(): void {
  try {
    const screenOrientation = screen.orientation as unknown as { unlock?: () => void };
    if (_orientationLocked && screenOrientation && screenOrientation.unlock) {
      screenOrientation.unlock();
      _orientationLocked = false;
    }
  } catch {
    // Not supported
  }
}

export function onOrientationChange(callback: () => void): () => void {
  const handler = () => {
    updateViewportHeight();
    if (_resizeTimer) clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(callback, 300);
  };

  window.addEventListener('resize', handler);
  window.addEventListener('orientationchange', handler);

  return () => {
    window.removeEventListener('resize', handler);
    window.removeEventListener('orientationchange', handler);
    if (_resizeTimer) clearTimeout(_resizeTimer);
  };
}
