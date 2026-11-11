import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import './style.css';
import './controls.css';
import App from './App';
import './updates';
import { isDesktop } from './tauriBridge';

// On desktop (Tauri) with HashRouter, ensure the app always starts at root route if no hash exists.
if (isDesktop && (!location.hash || location.hash === '')) {
  location.hash = '#/';
}

const basename = new URL(document.baseURI).pathname.replace(/\/$/, '') || '/';
// Preserve bookmarks created by the previous hash-based router.
if (!isDesktop && location.hash.startsWith('#/')) {
  const legacy = location.hash.slice(1);
  if (legacy.startsWith('/') && !legacy.startsWith('//')) {
    const target =
      basename === '/' || legacy === basename || legacy.startsWith(basename + '/')
        ? legacy
        : basename.replace(/\/$/, '') + legacy;
    history.replaceState(null, '', target);
  }
}

// Desktop runs on local/hash routing (tauri:// or file://) which breaks BrowserRouter path matching.
// Use HashRouter so the app always starts at the root route without route collision.
const Router = isDesktop ? HashRouter : BrowserRouter;
const routerProps = isDesktop ? {} : { basename };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router {...routerProps}>
      <App />
    </Router>
  </React.StrictMode>,
);
