import './ui/styles/main.css';
import { App, renderFatalError } from './app/App';
import { createLogger } from './core/logger';
import { detectLanguage, setLanguage, t } from './data/i18n';

const log = createLogger('boot');

function supportsWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

window.addEventListener('error', (event) => log.error('uncaught error', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => log.error('unhandled promise rejection', event.reason));

function boot(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app root element missing');
  if (!supportsWebGL2()) {
    setLanguage(detectLanguage());
    renderFatalError(root, t('app.webglError'));
    return;
  }
  try {
    const app = new App(root);
    app.start();
    document.getElementById('boot-splash')?.remove();
  } catch (error) {
    log.error('boot failed', error);
    renderFatalError(root, t('app.webglError'));
  }
}

boot();

// Offline support in production builds only (dev server stays cache-free).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error: unknown) => log.warn('service worker registration failed', error));
  });
}
