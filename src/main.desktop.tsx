import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './style.css';
import './controls.css';
import App from './App';
import './updates';
import { desktopAPI } from './tauriBridge';

if (!location.hash || location.hash === '') {
  location.hash = '#/';
}

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
