(function () {
  // Prevent Ctrl + '+', '-', '=', '0' browser zoom
  window.addEventListener(
    'keydown',
    function (e) {
      if (e.ctrlKey && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault();
      }
    },
    { passive: false },
  );

  // Prevent Ctrl + Wheel zoom
  window.addEventListener(
    'wheel',
    function (e) {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    },
    { passive: false },
  );

  // Prevent trackpad / touch gesture zoom on Windows high-DPI displays
  window.addEventListener(
    'gesturestart',
    function (e) {
      e.preventDefault();
    },
    { passive: false },
  );
  window.addEventListener(
    'gesturechange',
    function (e) {
      e.preventDefault();
    },
    { passive: false },
  );
  window.addEventListener(
    'gestureend',
    function (e) {
      e.preventDefault();
    },
    { passive: false },
  );

  // Prevent default drag-over and drag-drop navigation away from index.html
  window.addEventListener(
    'dragover',
    function (e) {
      e.preventDefault();
    },
    false,
  );

  window.addEventListener(
    'drop',
    function (e) {
      if (!e.defaultPrevented) {
        e.preventDefault();
      }
    },
    false,
  );

  // Route external HTTP/HTTPS links to default OS browser
  document.addEventListener(
    'click',
    function (e) {
      var el = e.target;
      while (el && el.tagName !== 'A') {
        el = el.parentElement;
      }
      if (el && el.tagName === 'A' && el.href) {
        var href = el.href;
        if (href.startsWith('http://') || href.startsWith('https://')) {
          if (!href.startsWith(window.location.origin)) {
            e.preventDefault();
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
              window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url: href });
            }
          }
        }
      }
    },
    true,
  );

  // Diagnostic error capturing for webview
  function reportDiagnostic(type, message, stack) {
    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
      window.__TAURI_INTERNALS__.invoke('record_diagnostic', {
        entry: {
          operation: type,
          level: 'error',
          code: 'Error',
          message: String(message),
          safeIdentifier: stack ? String(stack) : 'no_stack',
          durationMs: 0,
          retryable: false,
        },
      });
    }
  }

  window.addEventListener('error', function (e) {
    var msg =
      (e.message || 'Error') +
      ' at ' +
      (e.filename || '') +
      ':' +
      (e.lineno || '') +
      ':' +
      (e.colno || '');
    reportDiagnostic('js_error', msg, e.error && e.error.stack);
  });

  window.addEventListener('unhandledrejection', function (e) {
    var msg = 'Unhandled Rejection: ' + ((e.reason && (e.reason.message || e.reason)) || e);
    reportDiagnostic('unhandled_rejection', msg, e.reason && e.reason.stack);
  });

  window.addEventListener('vite:preloadError', function (e) {
    reportDiagnostic('vite_preload_error', String((e && e.payload) || 'Preload error'), 'preload');
  });

  // Reveal window on frontend ready to prevent white flash
  function notifyReady() {
    reportDiagnostic('webview_lifecycle', 'DOMContentLoaded/Ready at ' + window.location.href, '');
    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
      window.__TAURI_INTERNALS__.invoke('show_main_window');
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    notifyReady();
  } else {
    window.addEventListener('DOMContentLoaded', notifyReady);
  }
})();
