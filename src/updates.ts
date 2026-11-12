import { limits } from './limits';
import { desktopAPI, isDesktop, type DesktopUpdateInfo } from './tauriBridge';

declare const __APP_VERSION__: string | undefined;
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '2.0.0';
let registration: ServiceWorkerRegistration | undefined;
let applying = false;
let updateAvailable = false;
let desktopUpdateInfo: DesktopUpdateInfo | null = null;

export const hasUpdate = () => updateAvailable;
export const getUpdateInfo = () => desktopUpdateInfo;

function announce() {
  window.dispatchEvent(new Event('reader-update-ready'));
}

async function withTimeout<T>(task: Promise<T>, message: string) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), limits.updateTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function applyUpdate() {
  if (applying) return;
  applying = true;
  try {
    const tasks: Promise<unknown>[] = [];
    window.dispatchEvent(new CustomEvent('reader-before-update', { detail: tasks }));
    await withTimeout(Promise.all(tasks), 'Saving took too long. Try again before refreshing.');

    // On Desktop, download and install the signed release via Tauri updater
    if (isDesktop || desktopAPI.isDesktop) {
      if (desktopAPI.installUpdate) {
        await desktopAPI.installUpdate();
      }
      return;
    }

    // Another tab may already have activated the worker advertised by this banner.
    const worker = registration?.waiting;
    if (worker && worker.state !== 'activated')
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          worker.removeEventListener('statechange', changed);
          navigator.serviceWorker.removeEventListener('controllerchange', controlled);
          error ? reject(error) : resolve();
        };
        const changed = () => {
          if (worker.state === 'activated') finish();
          else if (worker.state === 'redundant')
            finish(new Error('The update was replaced. Try again.'));
        };
        const controlled = () => finish();
        const timer = setTimeout(
          () =>
            finish(new Error('The update did not finish. Follow the manual refresh steps below.')),
          limits.updateTimeoutMs,
        );
        worker.addEventListener('statechange', changed);
        navigator.serviceWorker.addEventListener('controllerchange', controlled);
        try {
          worker.postMessage({ type: 'SKIP_WAITING' });
          changed();
        } catch (e) {
          finish(e instanceof Error ? e : new Error('Unable to activate the update.'));
        }
      });
    if (typeof location !== 'undefined') {
      location.reload();
    }
  } finally {
    applying = false;
  }
}

// Desktop updater check initialization
if (isDesktop && typeof window !== 'undefined') {
  let lastDesktopCheck = 0;
  const checkDesktop = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (Date.now() - lastDesktopCheck < 30000) return;
    lastDesktopCheck = Date.now();
    try {
      const update = await desktopAPI.checkForUpdate?.();
      if (update) {
        desktopUpdateInfo = update;
        updateAvailable = true;
        announce();
      }
    } catch (e) {
      console.warn('Desktop update check error:', e);
    }
  };

  window.setTimeout(() => void checkDesktop(), 3000);
  document.addEventListener('visibilitychange', () => void checkDesktop());
  window.addEventListener('online', () => void checkDesktop());
  window.setInterval(() => void checkDesktop(), 60 * 60 * 1000);
}

// Web ServiceWorker initialization (only when not desktop)
if ('serviceWorker' in navigator && import.meta.env.PROD && !isDesktop) {
  const appURL = new URL(document.baseURI);
  // Include the bare hosted URL: its server redirect is unavailable offline.
  const scope = appURL.pathname === '/manga-reader/' ? '/manga-reader' : appURL.pathname;
  void navigator.serviceWorker
    .register(new URL('sw.js', appURL), { scope, updateViaCache: 'none' })
    .then((reg) => {
      registration = reg;
      // Retire the narrower registration only after its replacement is usable.
      // Existing tabs keep their controller until navigation; no forced reload.
      const retireOldScope = async () => {
        if (scope === appURL.pathname || reg.active?.state !== 'activated') return;
        const registrations = await navigator.serviceWorker.getRegistrations();
        const old = registrations.find((entry) => entry.scope === appURL.href);
        if (old?.active?.scriptURL === new URL('sw.js', appURL).href) await old.unregister();
      };
      const migrate = () => {
        void retireOldScope().catch((e) => console.warn('Offline scope migration failed.', e));
      };
      migrate();
      const ready = () => {
        if (reg.waiting) {
          updateAvailable = true;
          announce();
        }
      };
      // Keep the reload invitation if a different tab activates the new version.
      let hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && !applying) {
          updateAvailable = true;
          announce();
        }
        hadController = true;
      });
      const watch = () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') ready();
          if (worker.state === 'activated') migrate();
        });
      };
      ready();
      watch();
      reg.addEventListener('updatefound', watch);
      let last = 0;
      const check = () => {
        if (!navigator.onLine || document.hidden || Date.now() - last < 30000) return;
        last = Date.now();
        void reg
          .update()
          .then(ready)
          .catch(() => {});
      };
      check();
      document.addEventListener('visibilitychange', check);
      window.addEventListener('online', check);
      window.setInterval(check, 60000);
    })
    .catch((e) => console.warn('Offline registration unavailable.', e));
}
