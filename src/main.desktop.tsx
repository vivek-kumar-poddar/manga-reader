import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './style.css';
import App from './App';
import './updates';
import { desktopAPI } from './tauriBridge';

// On desktop (Tauri) with HashRouter, ensure the app always starts at root route if no hash exists.
if (!location.hash || location.hash === '') {
  location.hash = '#/';
}

// Reveal desktop window when UI is ready
if (typeof window !== 'undefined') {
  void desktopAPI.showMainWindow?.();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
