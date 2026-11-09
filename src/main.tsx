import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import './style.css';
import './controls.css';
import App from './App';
import './updates';

const isElectron =
  location.protocol === 'file:' ||
  navigator.userAgent.includes('Electron') ||
  !!(window as unknown as { electronAPI?: { isElectron: boolean } }).electronAPI?.isElectron;

// In Electron with HashRouter, ensure the app always starts at the root route if no hash exists.
if (isElectron && (!location.hash || location.hash === '')) {
  location.hash = '#/';
}

const basename = new URL(document.baseURI).pathname.replace(/\/$/, '') || '/';
// Preserve bookmarks created by the previous hash-based router.
if (!isElectron && location.hash.startsWith('#/')) {
  const legacy = location.hash.slice(1);
  if (legacy.startsWith('/') && !legacy.startsWith('//')) {
    const target =
      basename === '/' || legacy === basename || legacy.startsWith(basename + '/')
        ? legacy
        : basename.replace(/\/$/, '') + legacy;
    history.replaceState(null, '', target);
  }
}

// Electron loads from file:// which breaks BrowserRouter path matching.
// Use HashRouter so the app always starts at the root route.
const Router = isElectron ? HashRouter : BrowserRouter;
const routerProps = isElectron ? {} : { basename };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router {...routerProps}>
      <App />
    </Router>
  </React.StrictMode>,
);
