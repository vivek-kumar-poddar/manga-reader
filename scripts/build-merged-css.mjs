import fs from 'fs';

// Let's create the merged, clean, unified CSS content
const mergedCss = `/* Unified Manga Reader Stylesheet */
@import 'tailwindcss';
@custom-variant dark (&:where(.dark, .dark *));

/* Fonts */
@font-face {
  font-family: 'Inter';
  src: url('./fonts/Inter-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Inter';
  src: url('./fonts/Inter-SemiBold.woff2') format('woff2');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Instrument Serif';
  src: url('./fonts/InstrumentSerif-Regular.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Instrument Serif';
  src: url('./fonts/InstrumentSerif-Italic.ttf') format('truetype');
  font-weight: 400;
  font-style: italic;
  font-display: swap;
}

@font-face {
  font-family: 'Satoshi';
  src: url('./fonts/Satoshi-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Satoshi';
  src: url('./fonts/Satoshi-Medium.woff2') format('woff2');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Satoshi';
  src: url('./fonts/Satoshi-Bold.woff2') format('woff2');
  font-weight: 600;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'WantedSans';
  src: url('./fonts/WantedSans-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'WantedSans';
  src: url('./fonts/WantedSans-SemiBold.woff2') format('woff2');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'WantedSans';
  src: url('./fonts/WantedSans-Bold.woff2') format('woff2');
  font-weight: 600;
  font-style: normal;
  font-display: swap;
}

/* Design Tokens: Root Theme Variables */
:root {
  --font-size-ui: 15px;
  --font-size-title: 15px;
  --font-size-button: 15px;
  font-size: var(--font-size-ui);
  --font-ui:
    'WantedSans', 'Satoshi', 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    'Segoe UI', sans-serif;
  --font-display: 'Instrument Serif', Georgia, serif;
  font-family: var(--font-ui);
  color-scheme: light;
  background: #fafafa;
  color: #28282b;

  --surface: #ffffff;
  --text: #28282b;
  --muted: #737379;
  --line: rgba(0, 0, 0, 0.08);
  --line-hover: rgba(0, 0, 0, 0.15);
  --line-focus: rgba(0, 0, 0, 0.3);
  --soft: #f3f3f4;
  --extra-soft: #e4e4e7;
  --accent: #54545b;
  --success: #357052;

  --control-size: 38px;
  --control-radius: 7px;

  /* Subtle, multi-layered visible shadows without harsh outlines */
  --card-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px -1px rgba(0, 0, 0, 0.08);
  --card-hover-shadow: 0 4px 14px -1px rgba(0, 0, 0, 0.09), 0 2px 5px -1px rgba(0, 0, 0, 0.06);
  --floating-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.12), 0 4px 10px -2px rgba(0, 0, 0, 0.06);
  --shadow: var(--card-shadow);
}

:root.dark,
.dark {
  color-scheme: dark;
  background: #171719;
  color: #e9e9ec;

  --surface: #212124;
  --text: #e9e9ec;
  --muted: #a3a3ad;
  --line: rgba(255, 255, 255, 0.08);
  --line-hover: rgba(255, 255, 255, 0.15);
  --line-focus: rgba(255, 255, 255, 0.3);
  --soft: #2a2a2e;
  --extra-soft: #3f3f46;
  --accent: #b7b7c0;
  --success: #94c7a9;

  --control-size: 38px;
  --control-radius: 7px;

  /* Subtle, multi-layered visible dark shadows */
  --card-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.35), 0 1px 2px -1px rgba(0, 0, 0, 0.25);
  --card-hover-shadow: 0 4px 16px -2px rgba(0, 0, 0, 0.45), 0 2px 6px -1px rgba(0, 0, 0, 0.3);
  --floating-shadow: 0 14px 36px -4px rgba(0, 0, 0, 0.55), 0 4px 12px -2px rgba(0, 0, 0, 0.35);
  --shadow: var(--card-shadow);
}

/* Universal Reset & Base Styles */
* {
  box-sizing: border-box;
}

html,
body,
#root {
  margin: 0;
  padding: 0;
  min-height: 100dvh;
}

body {
  font-family: var(--font-ui);
  line-height: 1.5;
  color: var(--text);
  background: var(--surface);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1,
h2,
h3,
h4,
p,
figure,
blockquote,
dl,
dd {
  margin: 0;
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  cursor: pointer;
  background: none;
  border: none;
  font: inherit;
  color: inherit;
  padding: 0;
}

/* Universal Transitions: 0.3s ease-in-out on every hover effect to eliminate flickering */
button,
a,
summary,
input,
select,
textarea,
.dropdown-trigger,
.dropdown-item,
.menu-popover button,
.close-btn,
.bookmark-remove,
.chapter-card,
.manga-card,
.upload-zone {
  transition:
    background-color 0.3s ease-in-out,
    color 0.3s ease-in-out,
    border-color 0.3s ease-in-out,
    box-shadow 0.3s ease-in-out,
    stroke 0.3s ease-in-out,
    fill 0.3s ease-in-out,
    opacity 0.3s ease-in-out;
}

button svg,
a svg,
summary svg,
.dropdown-trigger svg,
.dropdown-item svg,
.close-btn svg,
.bookmark-remove svg {
  transition:
    stroke 0.3s ease-in-out,
    color 0.3s ease-in-out,
    fill 0.3s ease-in-out;
}

/* Button & Control Neutral Styling (No 4-sided borders; max 7px radius) */
button,
.dropdown-trigger,
summary.icon-button,
a.icon-button,
a.primary,
a.secondary,
.primary,
.secondary {
  border: none !important;
  border-radius: var(--control-radius);
  background: var(--soft);
  color: var(--text);
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px -1px rgba(0, 0, 0, 0.08);
}

button:not(:disabled):hover,
.dropdown-trigger:hover,
summary.icon-button:hover,
a.icon-button:hover,
a.primary:hover,
a.secondary:hover,
.primary:hover,
.secondary:hover {
  background: var(--extra-soft);
  color: var(--text);
}

button:disabled,
.dropdown-trigger:disabled {
  opacity: 0.5;
  cursor: default;
}

button:focus-visible,
summary.icon-button:focus-visible,
a.icon-button:focus-visible,
a:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--line-focus);
  outline-offset: 2px;
}

.primary,
.secondary,
.browse-button,
.dropdown-trigger,
.zoom-trigger {
  min-height: var(--control-size);
  gap: 8px;
  padding: 8px 12px;
  line-height: 1.35;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.icon-button,
.organized-bar .icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-size) !important;
  height: var(--control-size) !important;
  min-width: var(--control-size) !important;
  min-height: var(--control-size) !important;
  max-width: var(--control-size);
  max-height: var(--control-size);
  flex: 0 0 var(--control-size) !important;
  aspect-ratio: 1;
  padding: 0 !important;
  border: none !important;
  border-radius: var(--control-radius);
  background: var(--soft);
  color: var(--text);
  vertical-align: middle;
}

.icon-button:hover,
.organized-bar .icon-button:hover {
  background: var(--extra-soft);
  color: var(--text);
}

/* Close Buttons Base Geometry (Border radius 7px max, no 4-sided border) */
.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px !important;
  height: 32px !important;
  min-width: 32px !important;
  min-height: 32px !important;
  max-width: 32px;
  max-height: 32px;
  flex: 0 0 32px !important;
  aspect-ratio: 1;
  padding: 0 !important;
  border: none !important;
  border-radius: var(--control-radius);
  background: var(--soft);
  cursor: pointer;
  vertical-align: middle;
}

.close-btn svg,
.close-btn svg.lucide.lucide-x {
  width: 16px !important;
  height: 16px !important;
}

/* DELETE, TRASH, AND CLOSE BUTTON RULES:
   Light mode: default background var(--soft), red text/icon (#dc2626); on hover background #dc2626, white text/icon (#ffffff).
   Dark mode: default background var(--soft), red text/icon (#7f1d1d); on hover background #b91c1c, white text/icon (#ffffff).
   Smooth 0.3s ease-in-out transition on background-color and color/stroke.
*/
.close-btn,
.card-menu-close,
.bookmark-remove,
.bookmark-card .bookmark-remove,
button.danger-text,
.danger-text,
.menu-popover button.danger-text,
.import-success-close {
  background-color: var(--soft) !important;
  color: #dc2626 !important;
  border: none !important;
}

.close-btn svg,
.card-menu-close svg,
.bookmark-remove svg,
.bookmark-card .bookmark-remove svg,
button.danger-text svg,
.danger-text svg,
.menu-popover button.danger-text svg,
.import-success-close svg {
  color: #dc2626 !important;
  stroke: #dc2626 !important;
}

.close-btn:hover,
.close-btn:focus-visible,
.card-menu-close:hover,
.card-menu-close:focus-visible,
.bookmark-remove:hover,
.bookmark-remove:focus-visible,
.bookmark-card .bookmark-remove:hover,
.bookmark-card .bookmark-remove:focus-visible,
button.danger-text:hover,
button.danger-text:focus-visible,
.danger-text:hover,
.danger-text:focus-visible,
.menu-popover button.danger-text:hover,
.menu-popover button.danger-text:focus-visible,
.import-success-close:hover,
.import-success-close:focus-visible {
  background-color: #dc2626 !important;
  color: #ffffff !important;
  border: none !important;
}

.close-btn:hover svg,
.close-btn:focus-visible svg,
.card-menu-close:hover svg,
.card-menu-close:focus-visible svg,
.bookmark-remove:hover svg,
.bookmark-remove:focus-visible svg,
.bookmark-card .bookmark-remove:hover svg,
.bookmark-card .bookmark-remove:focus-visible svg,
button.danger-text:hover svg,
button.danger-text:focus-visible svg,
.danger-text:hover svg,
.danger-text:focus-visible svg,
.menu-popover button.danger-text:hover svg,
.menu-popover button.danger-text:focus-visible svg,
.import-success-close:hover svg,
.import-success-close:focus-visible svg {
  color: #ffffff !important;
  stroke: #ffffff !important;
}

/* Dark mode overrides for delete, trash, close buttons */
:root.dark .close-btn,
:root.dark .card-menu-close,
:root.dark .bookmark-remove,
:root.dark .bookmark-card .bookmark-remove,
:root.dark button.danger-text,
:root.dark .danger-text,
:root.dark .menu-popover button.danger-text,
:root.dark .import-success-close,
.dark .close-btn,
.dark .card-menu-close,
.dark .bookmark-remove,
.dark .bookmark-card .bookmark-remove,
.dark button.danger-text,
.dark .danger-text,
.dark .menu-popover button.danger-text,
.dark .import-success-close {
  background-color: var(--soft) !important;
  color: #7f1d1d !important;
  border: none !important;
}

:root.dark .close-btn svg,
:root.dark .card-menu-close svg,
:root.dark .bookmark-remove svg,
:root.dark .bookmark-card .bookmark-remove svg,
:root.dark button.danger-text svg,
:root.dark .danger-text svg,
:root.dark .menu-popover button.danger-text svg,
:root.dark .import-success-close svg,
.dark .close-btn svg,
.dark .card-menu-close svg,
.dark .bookmark-remove svg,
.dark .bookmark-card .bookmark-remove svg,
.dark button.danger-text svg,
.dark .danger-text svg,
.dark .menu-popover button.danger-text svg,
.dark .import-success-close svg {
  color: #7f1d1d !important;
  stroke: #7f1d1d !important;
}

:root.dark .close-btn:hover,
:root.dark .close-btn:focus-visible,
:root.dark .card-menu-close:hover,
:root.dark .card-menu-close:focus-visible,
:root.dark .bookmark-remove:hover,
:root.dark .bookmark-remove:focus-visible,
:root.dark .bookmark-card .bookmark-remove:hover,
:root.dark .bookmark-card .bookmark-remove:focus-visible,
:root.dark button.danger-text:hover,
:root.dark button.danger-text:focus-visible,
:root.dark .danger-text:hover,
:root.dark .danger-text:focus-visible,
:root.dark .menu-popover button.danger-text:hover,
:root.dark .menu-popover button.danger-text:focus-visible,
:root.dark .import-success-close:hover,
:root.dark .import-success-close:focus-visible,
.dark .close-btn:hover,
.dark .close-btn:focus-visible,
.dark .card-menu-close:hover,
.dark .card-menu-close:focus-visible,
.dark .bookmark-remove:hover,
.dark .bookmark-remove:focus-visible,
.dark .bookmark-card .bookmark-remove:hover,
.dark .bookmark-card .bookmark-remove:focus-visible,
.dark button.danger-text:hover,
.dark button.danger-text:focus-visible,
.dark .danger-text:hover,
.dark .danger-text:focus-visible,
.dark .menu-popover button.danger-text:hover,
.dark .menu-popover button.danger-text:focus-visible,
.dark .import-success-close:hover,
.dark .import-success-close:focus-visible {
  background-color: #b91c1c !important;
  color: #ffffff !important;
  border: none !important;
}

:root.dark .close-btn:hover svg,
:root.dark .close-btn:focus-visible svg,
:root.dark .card-menu-close:hover svg,
:root.dark .card-menu-close:focus-visible svg,
:root.dark .bookmark-remove:hover svg,
:root.dark .bookmark-remove:focus-visible svg,
:root.dark .bookmark-card .bookmark-remove:hover svg,
:root.dark .bookmark-card .bookmark-remove:focus-visible svg,
:root.dark button.danger-text:hover svg,
:root.dark button.danger-text:focus-visible svg,
:root.dark .danger-text:hover svg,
:root.dark .danger-text:focus-visible svg,
:root.dark .menu-popover button.danger-text:hover svg,
:root.dark .menu-popover button.danger-text:focus-visible svg,
:root.dark .import-success-close:hover svg,
:root.dark .import-success-close:focus-visible svg,
.dark .close-btn:hover svg,
.dark .close-btn:focus-visible svg,
.dark .card-menu-close:hover svg,
.dark .card-menu-close:focus-visible svg,
.dark .bookmark-remove:hover svg,
.dark .bookmark-remove:focus-visible svg,
.dark .bookmark-card .bookmark-remove:hover svg,
.dark .bookmark-card .bookmark-remove:focus-visible svg,
.dark button.danger-text:hover svg,
.dark button.danger-text:focus-visible svg,
.dark .danger-text:hover svg,
.dark .danger-text:focus-visible svg,
.dark .menu-popover button.danger-text:hover svg,
.dark .menu-popover button.danger-text:focus-visible svg,
.dark .import-success-close:hover svg,
.dark .import-success-close:focus-visible svg {
  color: #ffffff !important;
  stroke: #ffffff !important;
}

/* DROPDOWN MENUS AND POPOVERS:
   Edge-to-edge buttons, separated by bottom border, last-child has no border.
   No 4-sided outer border; border-radius max 7px; subtle yet clearly visible shadow.
*/
.dropdown-content,
.menu-popover {
  border: none !important;
  border-radius: var(--control-radius);
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--floating-shadow);
  overflow: hidden;
  padding: 0 !important;
  z-index: 110;
}

.dropdown-viewport {
  padding: 0 !important;
  margin: 0 !important;
  max-height: 300px;
  overscroll-behavior: contain;
}

.dropdown-item,
.menu-popover button,
.menu-popover a {
  position: relative;
  display: flex;
  align-items: center;
  width: 100% !important;
  margin: 0 !important;
  box-sizing: border-box;
  border-radius: 0 !important;
  border-top: none !important;
  border-left: none !important;
  border-right: none !important;
  border-bottom: 1px solid var(--line) !important;
  background: var(--soft);
  color: var(--text);
  padding: 9px 14px;
  cursor: pointer;
  user-select: none;
  outline: none;
  font-size: var(--font-size-button, 15px);
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.dropdown-item:last-child,
.menu-popover button:last-child,
.menu-popover a:last-child,
.menu-popover .danger-text:last-child {
  border-bottom: none !important;
}

.dropdown-item:hover,
.dropdown-item[data-highlighted],
.menu-popover button:hover,
.menu-popover a:hover {
  background: var(--extra-soft);
  color: var(--text);
}

.dropdown-check {
  position: absolute;
  right: 12px;
  display: flex;
  color: var(--text);
}

.dropdown-scroll {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  background: var(--surface);
  color: var(--muted);
}

.dropdown-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  min-height: var(--control-size);
  min-width: 0;
  max-width: 100%;
  padding: 7px 10px;
  border: none !important;
  border-radius: var(--control-radius);
  background: var(--soft);
  color: var(--text);
  font-size: var(--font-size-button, 15px);
  line-height: 1.4;
  cursor: pointer;
  text-align: left;
}

.dropdown-trigger:hover {
  background: var(--extra-soft);
}

.dropdown-trigger:focus-visible,
.dropdown-trigger[data-state='open'] {
  outline: 2px solid var(--line-focus);
  outline-offset: 1px;
}

.dropdown-trigger > span:first-child {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dropdown-chevron {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--muted);
}

@keyframes dropdown-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dropdown-content {
  min-width: var(--radix-select-trigger-width);
  max-width: min(420px, calc(100vw - 20px));
  max-height: min(320px, var(--radix-select-content-available-height));
  transform-origin: var(--radix-select-content-transform-origin);
  animation: dropdown-in 0.12s ease-out;
}

/* Typography Classes */
.font-display {
  font-family: var(--font-display);
}

.brand-title {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 32px;
  letter-spacing: -0.02em;
}

.brand-period {
  color: var(--text);
}

/* Header & Navigation Layout */
.library-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 32px;
  border-bottom: 1px solid var(--line);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.button-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0;
}

.dialog-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.collection-heading {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 6px;
  margin: 40px 0 24px;
}

.collection-heading > span {
  font-size: 16px;
  color: var(--muted);
}

.collection-heading h2 {
  font-size: 28px;
  font-weight: 600;
}

.shelf-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin: 40px 0 24px;
}

.shelf-toolbar .collection-heading {
  margin: 0;
}

.shelf-sort {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-ui, 15px) !important;
  color: var(--muted);
  flex-shrink: 0;
}

.shelf-sort > span {
  font-size: var(--font-size-ui, 15px) !important;
}

.shelf-sort .dropdown-trigger {
  min-width: 164px;
  width: auto;
  max-width: 100%;
}

/* Upload Zone & Actions (Cap radius to 7px; subtle multi-layer shadow; no harsh border) */
.upload-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 350px !important;
  border: none !important;
  border-radius: var(--control-radius) !important;
  background: var(--surface) !important;
  box-shadow: var(--card-shadow);
  padding: 40px 24px;
  cursor: pointer;
  text-align: center;
}

.upload-zone:hover,
.upload-zone.dragging {
  box-shadow: var(--card-hover-shadow);
  background: color-mix(in srgb, var(--surface) 98%, var(--soft)) !important;
}

.upload-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--control-radius);
  background: var(--soft);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
  color: var(--text);
}

.upload-zone .upload-buttons {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  width: min(100%, 380px);
  margin: 28px 0 ;
}

.upload-zone .upload-buttons > button {
  width: 100%;
  height: auto;
  min-height: max(44px, calc(var(--font-size-button, 15px) * 2.8));
  margin: 0;
  padding: 10px 12px;
  font-size: var(--font-size-button, 15px) !important;
  font-weight: 500;
  line-height: 1.35;
  gap: 8px;
  justify-content: center;
  white-space: nowrap;
  box-sizing: border-box;
  border: none !important;
  border-radius: var(--control-radius);
  background: var(--soft);
  color: var(--text);
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.08);
}

.upload-zone .upload-buttons > button:hover {
  background: var(--extra-soft);
  color: var(--text);
}

.upload-zone .upload-buttons > button svg {
  width: calc(var(--font-size-button, 15px) * 1.15) !important;
  height: calc(var(--font-size-button, 15px) * 1.15) !important;
  flex-shrink: 0;
}

.upload-zone .upload-note {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}

/* Manga Cards & Grid (Radius max 7px, no 4-sided border, multi-layer shadow) */
.manga-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.manga-card {
  border-radius: var(--control-radius);
  border: none !important;
  box-shadow: var(--card-shadow);
  background: var(--surface) !important;
  position: relative;
  display: flex;
  flex-direction: column;
  content-visibility: auto;
  contain-intrinsic-size: auto 350px auto 175px;
}

.manga-card:hover,
.manga-card:focus-within {
  box-shadow: var(--card-hover-shadow);
  background: color-mix(in srgb, var(--surface) 99%, #000) !important;
}

.dark .manga-card:hover,
.dark .manga-card:focus-within {
  background: color-mix(in srgb, var(--surface) 96%, #fff) !important;
}

.manga-open {
  display: flex;
  width: 100%;
  padding: 16px;
  gap: 16px;
  text-align: left;
  border: 0;
  background: transparent;
  align-items: stretch;
  cursor: pointer;
  border-radius: var(--control-radius) var(--control-radius) 0 0;
  user-select: none;
}

.manga-open:hover {
  background: transparent;
}

.cover {
  width: 120px;
  height: 160px;
  flex: 0 0 120px;
  border-radius: var(--control-radius);
  overflow: hidden;
  background: var(--soft);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none !important;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.manga-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  justify-content: space-between;
}

.manga-info h3 {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 400;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.manga-card-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px 16px;
}

.reading-progress {
  width: 100%;
  height: 4px;
  background: var(--soft);
  border-radius: var(--control-radius);
  overflow: hidden;
  margin-top: 8px;
}

.reading-progress span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease-in-out;
}

/* Bookmarks Section, Tabs, Cards & Shelf */
.bookmark-section {
  margin: 40px 0;
}

.bookmark-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.bookmark-section-heading h2 {
  font-size: 27px;
}

.bookmark-navigation {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-ui, 15px);
}

.bookmark-navigation > a {
  font-size: var(--font-size-ui, 15px);
  margin-right: 8px;
}

.bookmark-navigation button {
  font-size: var(--font-size-ui, 15px);
}

.bookmark-navigation svg {
  width: calc(var(--font-size-ui, 15px) * 1.1) !important;
  height: calc(var(--font-size-ui, 15px) * 1.1) !important;
}

.bookmark-tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--soft);
  border: none !important;
  padding: 4px;
  border-radius: var(--control-radius);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
}

.bookmark-tab-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px !important;
  border: none !important;
  border-radius: var(--control-radius);
  background: transparent !important;
  color: var(--muted);
  font-family: var(--font-ui);
  font-size: var(--font-size-ui, 14px);
  font-weight: 500;
  cursor: pointer;
  line-height: 1.2;
  box-shadow: none !important;
}

.bookmark-tab-button:hover {
  color: var(--text);
  background: var(--extra-soft) !important;
}

.bookmark-tab-button[aria-selected='true'] {
  background: var(--surface) !important;
  color: var(--text) !important;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
}

.bookmark-tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  padding: 2px 6px;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.05);
  color: var(--muted);
}

.dark .bookmark-tab-count {
  background: rgba(255, 255, 255, 0.08);
}

.bookmark-tab-button[aria-selected='true'] .bookmark-tab-count {
  background: rgba(0, 0, 0, 0.08);
  color: var(--text) !important;
}

.dark .bookmark-tab-button[aria-selected='true'] .bookmark-tab-count {
  background: rgba(255, 255, 255, 0.15);
  color: var(--text) !important;
}

.bookmark-track {
  display: flex;
  gap: 18px;
  overflow-x: auto;
  padding: 6px 3px 16px;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  cursor: grab;
  -ms-overflow-style: none;
}

.bookmark-track::-webkit-scrollbar {
  display: none;
}

.bookmark-track:active {
  cursor: grabbing;
}

.bookmark-track:focus-visible {
  outline: 2px solid var(--line-focus);
  outline-offset: 4px;
  border-radius: var(--control-radius);
}

.bookmark-track .bookmark-card {
  flex: 0 0 156px;
}

.bookmark-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(156px, 1fr));
  gap: 24px 18px;
}

.bookmark-card {
  position: relative;
  min-width: 0;
  background: var(--surface);
  border-radius: var(--control-radius);
  border: none !important;
  box-shadow: var(--card-shadow);
  transition: box-shadow 0.3s ease-in-out;
}

.bookmark-card:hover {
  box-shadow: var(--card-hover-shadow);
}

.bookmark-open {
  display: block;
  border-radius: inherit;
  overflow: hidden;
  user-select: none;
}

.bookmark-thumbnail {
  aspect-ratio: 3/4;
  width: 100%;
  background: var(--soft);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  overflow: hidden;
  border-radius: var(--control-radius) var(--control-radius) 0 0;
}

.bookmark-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bookmark-caption {
  padding: 12px;
}

.bookmark-caption h3 {
  font-family: var(--font-display);
  font-size: 18px !important;
  font-weight: 400;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bookmark-caption p {
  font-size: 16px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bookmark-caption-bottom {
  font-size: 14px;
  color: var(--muted);
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-top: 15px;
  gap: 8px;
}

.bookmark-caption-bottom p {
  font-size: 14px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
}

.bookmark-page-number {
  font-size: var(--font-size-ui, 15px);
  color: var(--muted);
  white-space: nowrap;
}

.bookmark-card .bookmark-remove {
  position: absolute;
  top: 7px;
  right: 7px;
  --control-size: 32px;
  opacity: 0.94;
}

/* Empty Bookmarks Layout (Checked by tests) */
.library-main.bookmarks-empty {
  padding-top: 0;
}

.library-main.bookmarks-empty .page-heading {
  display: none !important;
}

.library-main.bookmarks-empty .empty-shelf,
.bookmarks-page-content .empty-shelf {
  flex: 1;
  margin: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.library-main.bookmarks-empty .library-footer {
  margin-top: 0;
}

.bookmarks-page-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: calc(100dvh - 100px);
}

.bookmarks-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}

.shelf-sort.bookmark-sort {
  margin-left: auto;
}

/* Modals & Dialogs (No 4-sided borders; max 7px radius; subtle floating shadow) */
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
  animation: fadeIn 0.15s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.tabbed-modal,
.settings-panel,
.tabbed-modal.settings-panel,
.shortcuts-modal,
.import-modal,
.confirm-modal,
.import-success-modal {
  position: fixed;
  z-index: 51;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: var(--surface);
  color: var(--text);
  border: none !important;
  border-radius: var(--control-radius);
  box-shadow: var(--floating-shadow);
  overflow: hidden;
}

.tabbed-modal.settings-panel,
.settings-panel {
  width: min(760px, calc(100vw - 32px));
  height: min(710px, calc(100dvh - 48px));
  max-height: calc(100dvh - 48px);
  padding: 0;
  display: flex;
  flex-direction: column;
}

.modal-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--line);
}

.settings-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--line);
  background: var(--soft);
}

.settings-tabs button {
  padding: 8px 14px;
  border: none !important;
  border-radius: var(--control-radius);
  background: transparent;
  color: var(--muted);
  font-weight: 500;
  cursor: pointer;
}

.settings-tabs button:hover {
  background: var(--extra-soft);
  color: var(--text);
}

.settings-tabs button[aria-selected='true'] {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.08);
}

.settings-tab-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

.settings-tab-body section {
  margin-bottom: 28px;
}

.settings-tab-body section h3 {
  margin-bottom: 12px;
  font-size: var(--font-size-title, 15px) !important;
  font-weight: 600;
}

.storage-stats {
  margin: 16px 0;
  border: none !important;
  background: var(--soft);
  border-radius: var(--control-radius);
  padding: 12px 18px;
}

.storage-stats > div {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 4px 0;
}

.shortcuts-modal {
  padding: 24px 28px;
  width: min(620px, calc(100vw - 32px));
  max-height: calc(100dvh - 48px);
  overflow: auto;
}

.shortcuts-modal .dialog-heading,
.import-modal .dialog-heading,
.confirm-modal .dialog-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 16px;
}

.shortcuts-modal .dialog-heading h2,
.import-modal .dialog-heading h2,
.confirm-modal .dialog-heading h2 {
  font-size: 20px !important;
  font-weight: 600;
  line-height: 1.3;
  margin: 0;
  color: var(--text);
  text-align: left;
}

.shortcuts-modal > p,
.shortcuts-modal [data-radix-dialog-description],
.import-modal [data-radix-dialog-description],
.confirm-modal [data-radix-dialog-description] {
  font-size: 15px;
  color: var(--muted);
  line-height: 1.55;
  margin: 0 0 20px 0;
  text-align: left;
}

.shortcuts-modal .button-row,
.import-modal .button-row,
.confirm-modal .button-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin: 20px 0 0 0;
  gap: 12px;
}

.confirm-modal {
  width: min(440px, calc(100vw - 32px)) !important;
  max-width: 440px;
  padding: 24px;
}

.import-success-modal {
  width: min(650px, calc(100vw - 32px));
  padding: 28px;
}

.import-success-close {
  position: absolute;
  right: 12px;
  top: 12px;
  z-index: 1;
}

.import-success-items {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.import-success-title {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 28px;
  align-items: stretch;
}

.import-success-cover {
  aspect-ratio: 3/4;
  border-radius: var(--control-radius);
  background: var(--soft);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
}

.import-success-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.import-success-info {
  padding: 18px 20px 0 0;
}

.import-success-info .eyebrow {
  display: block;
  font-size: 16px;
  margin-bottom: 12px;
}

.import-success-info h2 {
  font-size: 30px;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.import-success-info dl {
  margin: 24px 0 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.import-success-info dl > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  font-size: 16px;
}

.import-success-info dt {
  color: var(--muted);
}

.import-success-info dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.import-success-ok {
  position: absolute;
  right: 28px;
  bottom: 28px;
  min-width: 80px;
}

.import-success-issues {
  margin-top: 20px;
  margin-bottom: 48px;
  font-size: 16px;
}

.import-success-issues summary {
  cursor: pointer;
}

/* Manga Details & Chapter Grid (Radius max 7px; no 4-sided border; subtle shadow) */
.manga-details {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 28px 64px;
}

.manga-details-nav,
.chapter-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 28px;
}

.manga-overview {
  display: grid;
  grid-template-columns: minmax(180px, 280px) minmax(0, 1fr);
  gap: 40px;
  align-items: center;
  margin-bottom: 48px;
}

.manga-overview .cover {
  width: 100%;
  height: auto;
  aspect-ratio: 2 / 3;
  border-radius: var(--control-radius);
  border: none !important;
  overflow: hidden;
}

.manga-overview h1 {
  font-size: clamp(28px, 4vw, 48px);
  overflow-wrap: anywhere;
  line-height: 1.15;
  margin: 0 0 24px;
}

.manga-totals {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  padding-block: 20px;
  border-block: 1px solid var(--line);
}

.manga-totals dt,
.chapter-card span,
.chapter-card small {
  color: var(--muted);
  font-size: 16px;
}

.manga-totals dd {
  margin: 8px 0 0;
  font-size: 24px;
}

.manga-current {
  margin: 24px 0;
}

.chapter-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.chapter-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  background: var(--surface);
  border: none !important;
  border-radius: var(--control-radius);
  box-shadow: var(--card-shadow);
  text-decoration: none;
  overflow-wrap: anywhere;
}

.chapter-card:hover,
.chapter-card[aria-current] {
  box-shadow: var(--card-hover-shadow);
  background: var(--soft);
}

.chapter-search {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(100%, 340px);
  min-width: 0;
  padding: 0 12px;
  border: none !important;
  border-radius: var(--control-radius);
  background: var(--soft);
  color: var(--muted);
  box-shadow: var(--card-shadow);
}

.chapter-search:focus-within {
  box-shadow: var(--card-hover-shadow);
  outline: 2px solid var(--line-focus);
  outline-offset: 1px;
}

.chapter-search input {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 10px 0;
  border: 0;
  background: transparent;
  color: var(--text);
  outline: none;
  box-shadow: none;
}

.chapter-search svg {
  flex-shrink: 0;
}

/* Toast & Feedback Notifications */
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 60;
  display: flex;
  align-items: center;
  background: var(--surface);
  color: var(--text);
  gap: 12px;
  padding: 10px 12px 10px 16px;
  box-shadow: var(--floating-shadow);
  border: none !important;
  border-radius: var(--control-radius);
}

.toast .close-btn {
  margin-left: auto;
}

.update-banner {
  position: fixed;
  z-index: 40;
  left: 50%;
  bottom: 110px;
  transform: translateX(-50%);
  background: var(--surface);
  border: none !important;
  box-shadow: var(--floating-shadow);
  border-radius: var(--control-radius);
  padding: 13px 18px;
  width: min(430px, calc(100vw - 30px));
  font-size: 16px;
}

.update-banner button {
  padding: 6px 10px;
  text-decoration: none;
  border-radius: var(--control-radius);
}

/* Edge Reading Progress Bar */
.edge-progress {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 35;
  background: var(--line);
  pointer-events: none;
  opacity: 0;
  transition: opacity 180ms ease;
}

.edge-progress > span {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--text);
  opacity: 0.55;
  transform: scaleX(0);
  transform-origin: left;
}

.reader:has(.reader-top.bar-hidden):has(.reader-bottom.bar-hidden):not(
    :has(.reader-bar:focus-within, .reader-bar details[open], .dropdown-trigger[data-state='open'])
  )
  .edge-progress {
  opacity: 1;
}

/* Reader Core Layout & Controls */
.reader {
  position: relative;
  min-height: 100dvh;
  background: var(--surface);
  color: var(--text);
}

.reader-content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.reader-page {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
}

.reader-page img {
  display: block;
  max-width: 100%;
  height: auto;
}

.reader-single .reader-content {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100dvh;
}

.reader-bar {
  position: fixed;
  left: 0;
  right: 0;
  z-index: 30;
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--floating-shadow);
  transition:
    transform 0.25s ease-in-out,
    opacity 0.25s ease-in-out;
}

.reader-top {
  top: 0;
}

.reader-bottom {
  bottom: 0;
}

.reader-top.bar-hidden {
  transform: translateY(-100%);
  opacity: 0;
  pointer-events: none;
}

.reader-bottom.bar-hidden {
  transform: translateY(100%);
  opacity: 0;
  pointer-events: none;
}

.reader-bar:has(.dropdown-trigger[data-state='open']) {
  opacity: 1;
  pointer-events: auto;
  transform: none;
}

.reader-top.organized-bar,
.reader-bottom.organized-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 18px;
  flex-wrap: nowrap;
  padding: 10px 20px;
  min-height: 56px;
  align-items: center;
}

.reader-bottom.organized-bar {
  grid-template-columns: minmax(215px, 1fr) minmax(130px, 360px) minmax(215px, 1fr);
}

.organized-bar .header-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
}

.organized-bar .reader-title {
  font-size: 16px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.organized-bar .header-selectors {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.organized-bar .header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.organized-bar .chapter-navigation {
  display: flex;
  align-items: center;
  gap: 6px;
}

.organized-bar .chapter-navigation .chapter-select {
  width: 135px;
  max-width: 150px;
}

.organized-bar .page-progress-control {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.organized-bar .reading-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.current-page-input {
  width: 44px;
  min-height: 32px;
  text-align: center;
  border: none !important;
  border-radius: var(--control-radius);
  background: var(--soft);
  color: var(--text);
  font-size: var(--font-size-ui, 15px);
}

.total-page-count {
  font-size: var(--font-size-ui, 15px);
  color: var(--muted);
}

.page-progress-slider {
  appearance: none;
  -webkit-appearance: none;
  flex: 1;
  min-width: 40px;
  width: 100%;
  height: 4px;
  border: 0;
  border-radius: var(--control-radius);
  margin: 0;
  background: linear-gradient(
    to right,
    var(--accent) 0 var(--progress-fill),
    var(--line) var(--progress-fill) 100%
  );
  cursor: pointer;
  touch-action: none;
}

.page-progress-slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  background: var(--accent);
  border: 2px solid var(--surface);
  border-radius: var(--control-radius);
  box-shadow: none;
}

.page-progress-slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  background: var(--accent);
  border: 2px solid var(--surface);
  border-radius: var(--control-radius);
  box-shadow: none;
}

.page-progress-slider:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}

/* Completion & Playback Active States */
.completion-button.completed,
.playback-button.active {
  background: var(--soft);
  color: var(--text);
}

/* Popover Panels (Radius max 7px; no 4-sided border; subtle shadow) */
.bar-popover-panel {
  position: absolute;
  bottom: calc(100% + 14px);
  right: 0;
  width: 278px;
  background: var(--surface);
  border: none !important;
  border-radius: var(--control-radius);
  padding: 18px;
  box-shadow: var(--floating-shadow);
  max-height: calc(100dvh - 145px);
  overflow: auto;
}

.bar-popover-panel h3 {
  font-size: 20px;
  margin-bottom: 14px;
}

.chapter-end {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 15;
  border: none !important;
  background: var(--surface);
  padding: 24px;
  border-radius: var(--control-radius);
  box-shadow: var(--floating-shadow);
  max-width: calc(100vw - 32px);
  width: max-content;
}

.reader-error {
  width: 70%;
  font-size: 16px;
  background: var(--soft);
  border: none !important;
  padding: 20px;
  border-radius: var(--control-radius);
  box-shadow: var(--card-shadow);
}

/* Typography Font-Size and Element Hierarchy (Unified from controls.css) */
body,
input,
select,
textarea,
.settings-panel,
.tabbed-modal.settings-panel,
.modal-heading > p,
.settings-tab-body section p,
.settings-tab-body label,
.settings-tab-body select,
.settings-tab-body input,
.reader-bar,
.reader-top,
.reader-bottom,
.reader-bottom .current-page-input,
.reader-bottom .total-page-count,
.reader-top select,
.reader-bottom select,
.header-selectors select,
.bar-popover-panel,
.bar-popover-panel label,
.library-footer,
.library-footer span,
.library-footer a,
.bookmark-navigation,
.bookmark-navigation > a,
.bookmark-navigation button,
.bookmark-tabs,
.bookmark-tab-button,
.bookmarks-toolbar,
.shelf-sort,
.shelf-sort > span,
.shelf-sort.bookmark-sort,
.shelf-sort.bookmark-sort > span,
.manga-card-date-badge,
.manga-card-date,
.space-tooltip,
.manga-bookmark-btn,
.manga-info-btn,
.relink-needed-btn,
.manga-card-bottom .card-menu summary,
summary.card-menu-trigger,
.card-menu summary,
.menu-popover,
.menu-popover button {
  font-size: var(--font-size-ui, 15px) !important;
}

.modal-heading .dialog-heading h2,
.settings-panel h3,
.settings-tab-body section h3,
.reader-title,
.organized-bar .reader-title,
.bar-popover-panel h3,
.manga-info h3,
.bookmark-card h3 {
  font-size: var(--font-size-title, 15px) !important;
}

button:not(.manga-bookmark-btn):not(.manga-info-btn):not(.relink-needed-btn):not(
    .menu-popover button
  ),
.dropdown-trigger,
.dropdown-trigger span,
.shelf-sort .dropdown-trigger,
.shelf-sort .dropdown-trigger span,
.shelf-sort.bookmark-sort .dropdown-trigger,
.shelf-sort.bookmark-sort .dropdown-trigger span,
.dropdown-content,
.dropdown-item,
.dropdown-item span,
option,
select,
.chapter-select,
.zoom-trigger,
.bar-popover > summary,
summary.icon-button:not(.card-menu-trigger),
.icon-button,
a.icon-button,
a.primary,
a.secondary,
.primary,
.secondary,
.browse-button,
.support-button,
.settings-tabs button,
.bar-popover-panel button,
.reader-bottom .zoom-trigger,
.organized-bar .chapter-navigation .chapter-select {
  font-size: var(--font-size-button, 15px) !important;
  font-weight: 500 !important;
  text-transform: capitalize;
}

/* Button & Control Proportional SVG Scaling */
button:not(.manga-bookmark-btn):not(.manga-info-btn):not(.relink-needed-btn):not(
    .menu-popover button
  )
  svg,
.dropdown-trigger svg,
.dropdown-chevron svg,
.dropdown-check svg,
.dropdown-scroll svg,
.zoom-trigger svg,
.bar-popover > summary svg,
.icon-button svg,
summary.icon-button:not(.card-menu-trigger) svg,
a.icon-button svg,
a.primary svg,
a.secondary svg,
.primary svg,
.secondary svg,
.browse-button svg,
.support-button svg {
  width: calc(var(--font-size-button, 15px) * 1.15) !important;
  height: calc(var(--font-size-button, 15px) * 1.15) !important;
}

.dropdown-trigger .dropdown-chevron svg,
.dropdown-chevron svg,
.dropdown-check svg,
.dropdown-scroll svg {
  width: calc(var(--font-size-button, 15px) * 0.933) !important;
  height: calc(var(--font-size-button, 15px) * 0.933) !important;
}

.zoom-trigger svg,
.bar-popover.zoom-menu > summary svg {
  width: calc(var(--font-size-button, 15px) * 0.8) !important;
  height: calc(var(--font-size-button, 15px) * 0.8) !important;
}

.manga-card-calendar-icon,
.manga-card-date-badge svg {
  width: calc(var(--font-size-ui, 15px) * 1.05) !important;
  height: calc(var(--font-size-ui, 15px) * 1.05) !important;
  flex-shrink: 0;
}

.manga-bookmark-btn svg {
  width: calc(var(--font-size-ui, 15px) * 1.08) !important;
  height: calc(var(--font-size-ui, 15px) * 1.08) !important;
  flex-shrink: 0;
}

.manga-info-btn svg {
  width: calc(var(--font-size-ui, 15px) * 1.15) !important;
  height: calc(var(--font-size-ui, 15px) * 1.15) !important;
  flex-shrink: 0;
}

.card-menu summary svg,
.manga-card-bottom .card-menu summary svg,
summary.card-menu-trigger svg {
  width: calc(var(--font-size-ui, 15px) * 1.15) !important;
  height: calc(var(--font-size-ui, 15px) * 1.15) !important;
  flex-shrink: 0;
}

.menu-popover button svg {
  width: calc(var(--font-size-ui, 15px) * 1.08) !important;
  height: calc(var(--font-size-ui, 15px) * 1.08) !important;
  flex-shrink: 0;
}

/* Responsive Media Queries */
@media (max-width: 1100px) {
  .reader-bottom.organized-bar {
    grid-template-columns: 210px minmax(100px, 1fr) 204px;
    gap: 12px;
  }

  .organized-bar .chapter-navigation .chapter-select {
    width: 128px;
  }
}

@media (max-width: 1000px) {
  .chapter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 800px) {
  :root {
    --control-size: 40px;
  }

  .reader-top.organized-bar {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'identity actions' 'selectors selectors';
    gap: 8px;
    padding: 8px 12px;
    padding-top: max(8px, env(safe-area-inset-top));
  }

  .organized-bar .header-identity {
    grid-area: identity;
    min-width: 0;
    gap: 8px;
  }

  .organized-bar .header-actions {
    grid-area: actions;
    gap: 8px;
  }

  .organized-bar .header-selectors {
    grid-area: selectors;
    justify-content: center;
    gap: 8px;
    padding: 0;
    overflow-x: auto;
  }

  .organized-bar .reader-title {
    font-size: 16px;
  }

  .reader-bottom.organized-bar {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'progress progress' 'chapters actions';
    gap: 8px;
    padding: 8px 12px;
    padding-bottom: max(8px, env(safe-area-inset-bottom));
  }

  .organized-bar .page-progress-control {
    grid-area: progress;
    width: 100%;
    justify-self: stretch;
    gap: 8px !important;
  }

  .organized-bar .chapter-navigation {
    grid-area: chapters;
    gap: 4px !important;
    min-width: 0;
  }

  .organized-bar .reading-actions {
    grid-area: actions;
    gap: 4px !important;
    justify-content: flex-end;
  }

  .organized-bar .chapter-navigation .chapter-select {
    width: clamp(56px, 18vw, 135px);
    max-width: 135px;
    flex-shrink: 1;
    gap: 4px;
    padding: 6px;
    font-size: 16px;
  }

  .organized-bar .reading-actions .zoom-trigger {
    height: var(--control-size);
    min-height: var(--control-size);
    min-width: 48px;
    padding: 4px;
    font-size: 16px;
  }

  .current-page-input {
    width: 40px !important;
    min-height: 32px;
    font-size: 16px !important;
  }

  .total-page-count {
    font-size: 16px;
    min-width: 24px;
  }

  .update-banner {
    bottom: 120px;
  }

  .bar-popover-panel {
    max-height: calc(100dvh - 150px);
    overflow: auto;
  }
}

@media (max-width: 600px) {
  .shelf-toolbar {
    align-items: flex-start;
    flex-direction: column;
    gap: 16px;
  }

  .shelf-sort {
    align-self: flex-end;
  }

  .manga-details {
    padding: 16px 18px 40px;
  }

  .manga-overview {
    grid-template-columns: minmax(100px, 1fr) minmax(0, 1.5fr);
    gap: 18px;
    align-items: start;
  }

  .manga-overview h1 {
    font-size: 26px;
  }

  .manga-totals {
    gap: 12px;
    padding-block: 12px;
  }

  .manga-totals dd {
    font-size: 20px;
  }

  .chapter-grid {
    grid-template-columns: 1fr;
  }

  .chapter-list-heading {
    align-items: start;
    flex-direction: column;
  }
}

@media (max-width: 540px) {
  .import-success-modal {
    padding: 20px;
  }

  .import-success-title {
    grid-template-columns: 1fr;
    gap: 20px;
  }

  .import-success-cover {
    aspect-ratio: 16/10;
  }

  .import-success-info {
    padding: 0;
    padding-bottom: 44px;
  }

  .import-success-info h2 {
    font-size: 27px;
  }

  .import-success-info dl {
    margin-top: 20px;
  }

  .import-success-ok {
    right: 20px;
    bottom: 20px;
  }
}

@media (max-width: 480px) {
  .bookmark-section {
    margin: 32px 0;
  }

  .bookmark-section-heading {
    gap: 8px;
  }

  .bookmark-section-heading h2 {
    font-size: 24px;
  }

  .bookmark-navigation {
    gap: 4px;
  }

  .bookmark-navigation > a {
    margin-right: 4px;
  }

  .bookmark-track {
    gap: 14px;
  }

  .bookmark-track .bookmark-card {
    flex-basis: 144px;
  }

  .bookmark-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px 14px;
  }

  .bookmark-card .bookmark-remove {
    --control-size: 36px;
  }

  .bookmarks-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
  }

  .bookmark-tabs {
    width: 100%;
    display: flex;
  }

  .bookmark-tab-button {
    flex: 1;
    justify-content: center;
    padding: 8px 10px;
  }

  .shelf-sort.bookmark-sort {
    margin-left: 0;
    width: 100%;
    justify-content: space-between;
  }

  .organized-bar .chapter-navigation .icon-button {
    width: 26px;
    flex-basis: 26px;
    min-height: 44px;
  }

  .organized-bar .chapter-navigation .chapter-select {
    width: 66px;
    min-height: 36px;
    padding: 6px 5px;
    gap: 2px;
    font-size: 16px;
  }

  .organized-bar .reading-actions .icon-button {
    width: 26px;
    flex-basis: 26px;
    min-height: 44px;
  }

  .organized-bar .reading-actions .zoom-trigger {
    min-width: 44px;
    padding: 0 1px;
    font-size: 16px;
  }

  .collection-heading h2 {
    font-size: 24px;
  }

  .page-heading p {
    min-height: 24px;
    font-size: 16px;
  }
}

@media (max-width: 390px) {
  .upload-zone .upload-buttons {
    grid-template-columns: 1fr;
    width: min(100%, 240px);
    gap: 10px;
  }
}

@media (max-width: 359px) {
  .reader-top.organized-bar,
  .reader-bottom.organized-bar {
    padding-left: 6px;
    padding-right: 6px;
    column-gap: 4px;
  }

  .organized-bar .reading-actions,
  .organized-bar .chapter-navigation {
    gap: 2px !important;
  }

  .organized-bar .reading-actions .zoom-trigger {
    min-width: 42px;
  }

  .organized-bar .chapter-navigation .chapter-select {
    width: 52px;
  }

  .organized-bar .header-selectors {
    justify-content: flex-start;
  }
}

@media (pointer: coarse) and (min-width: 400px) {
  :root {
    --control-size: 44px;
  }
}
`;

fs.writeFileSync('src/style.css', mergedCss, 'utf-8');
console.log('Merged style.css written successfully. Length:', mergedCss.length);

