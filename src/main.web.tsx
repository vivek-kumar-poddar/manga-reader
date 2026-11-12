import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './style.css';
import './controls.css';
import App from './App';
import './updates';

const basename = new URL(document.baseURI).pathname.replace(/\/$/, '') || '/';
// Preserve bookmarks created by the previous hash-based router.
if (location.hash.startsWith('#/')) {
  const legacy = location.hash.slice(1);
  if (legacy.startsWith('/') && !legacy.startsWith('//')) {
    const target =
      basename === '/' || legacy === basename || legacy.startsWith(basename + '/')
        ? legacy
        : basename.replace(/\/$/, '') + legacy;
    history.replaceState(null, '', target);
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
