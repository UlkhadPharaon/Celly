import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-700.css';
import './styles/main.css';

import { CellyApp } from './core/app';

const mount = document.getElementById('app');
if (!mount) throw new Error('Celly: #app mount point is missing from index.html');

const app = new CellyApp(mount);
app.start();

declare global {
  interface Window {
    /** Debug / test handle (used by the Playwright screenshot specs). */
    __celly?: CellyApp;
  }
}
window.__celly = app;
