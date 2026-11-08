import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-700.css';
import './styles/main.css';

import { CellyApp } from './core/app';
import { ErrorBoundary } from './ui/errorBoundary';

const mount = document.getElementById('app') as HTMLElement;

/**
 * Full (re)boot of the application. The error boundary calls this again for its Retry action
 * after the previous instance has been disposed, so a partial construction is torn down before
 * a new one is created.
 */
function boot(): void {
  const app = new CellyApp(mount);
  app.start();
  window.__celly = app;
}

const boundary = new ErrorBoundary({
  onRetry: () => {
    try {
      window.__celly?.dispose();
    } catch {
      // Dispose itself crashing must not block the recovery path.
    }
    mount.textContent = '';
    try {
      boot();
      boundary.hide();
    } catch (err) {
      boundary.show(err);
    }
  }
});

// Install the listeners before the first boot so nothing can escape them, then boot inside a
// try/catch: a synchronous construction failure must show the overlay without waiting for
// an error event the page may never emit.
window.addEventListener('error', (e) => boundary.show(e.error ?? new Error(e.message || 'Unknown error')));
window.addEventListener('unhandledrejection', (e) => {
  boundary.show(e.reason instanceof Error ? e.reason : new Error(String(e.reason)));
});

boundary.attach(document.body);
try {
  boot();
} catch (err) {
  boundary.show(err);
}

declare global {
  interface Window {
    /** Debug / test handle (used by the Playwright screenshot specs). */
    __celly?: CellyApp;
  }
}
