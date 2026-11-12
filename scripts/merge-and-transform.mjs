import fs from 'fs';

// Helper to cap any radius in a string
function capRadius(str) {
  str = str.replace(/border-radius:\s*([8-9]|[1-9][0-9]+)px(\s*!important)?/g, 'border-radius: 7px$2');
  str = str.replace(/border-radius:\s*([0-9]+)px\s+([0-9]+)px\s+([0-9]+)px\s+([0-9]+)px(\s*!important)?/g, (m, a, b, c, d, imp) => {
    return `border-radius: ${Math.min(parseInt(a), 7)}px ${Math.min(parseInt(b), 7)}px ${Math.min(parseInt(c), 7)}px ${Math.min(parseInt(d), 7)}px${imp || ''}`;
  });
  str = str.replace(/border-radius:\s*([0-9]+)px\s+([0-9]+)px\s+([0-9]+)px(\s*!important)?/g, (m, a, b, c, imp) => {
    return `border-radius: ${Math.min(parseInt(a), 7)}px ${Math.min(parseInt(b), 7)}px ${Math.min(parseInt(c), 7)}px${imp || ''}`;
  });
  str = str.replace(/border-radius:\s*([0-9]+)px\s+([0-9]+)px(\s*!important)?/g, (m, a, b, imp) => {
    return `border-radius: ${Math.min(parseInt(a), 7)}px ${Math.min(parseInt(b), 7)}px${imp || ''}`;
  });
  str = str.replace(/border-radius:\s*50%/g, 'border-radius: 7px');
  str = str.replace(/border-radius:\s*20px/g, 'border-radius: 7px');
  str = str.replace(/border-radius:\s*15px/g, 'border-radius: 7px');
  str = str.replace(/border-radius:\s*14px/g, 'border-radius: 7px');
  str = str.replace(/border-radius:\s*12px/g, 'border-radius: 7px');
  str = str.replace(/border-radius:\s*10px/g, 'border-radius: 7px');
  str = str.replace(/border-radius:\s*9px/g, 'border-radius: 7px');
  str = str.replace(/border-radius:\s*8px/g, 'border-radius: 7px');
  return str;
}

let style = fs.readFileSync('src/style.css', 'utf-8');

// 1. Authoritative Root Tokens
const oldRootRegex = /:root\s*\{[^}]*font-size:\s*var\(--font-size-ui\);[^}]*color-scheme:\s*light;\s*\}/s;
const newRoot = `:root {
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
}`;

const oldDarkRegex = /:root\.dark\s*\{[^}]*color-scheme:\s*dark;\s*\}/s;
const newDark = `:root.dark,
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
  --soft: #26262a;
  --extra-soft: #404046;
  --accent: #b7b7c0;
  --success: #94c7a9;

  --control-size: 38px;
  --control-radius: 7px;

  /* Subtle, multi-layered visible dark shadows */
  --card-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.35), 0 1px 2px -1px rgba(0, 0, 0, 0.25);
  --card-hover-shadow: 0 4px 16px -2px rgba(0, 0, 0, 0.45), 0 2px 6px -1px rgba(0, 0, 0, 0.3);
  --floating-shadow: 0 14px 36px -4px rgba(0, 0, 0, 0.55), 0 4px 12px -2px rgba(0, 0, 0, 0.35);
  --shadow: var(--card-shadow);
}`;

style = style.replace(oldRootRegex, newRoot);
style = style.replace(oldDarkRegex, newDark);

// Remove the second :root and :root.dark block in style.css (around line 2881)
const secondRootRegex = /\/\* Neutral themes: fixed control borders, shadow-only raised surfaces\. \*\/[\s\S]*?:root\.dark\s*\{[\s\S]*?color:\s*var\(--text\);\s*\}/;
style = style.replace(secondRootRegex, '/* Neutral themes: unified control tokens & raised surfaces */');

// Cap all border-radius in style
style = capRadius(style);

// 2. Eliminate 4-sided borders around cards, modals, dropdowns, search inputs, storage-stats
style = style.replace(/\.chapter-card\s*\{[^}]*\}/, `.chapter-card {
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
  transition:
    box-shadow 0.3s ease-in-out,
    background-color 0.3s ease-in-out;
}`);

style = style.replace(/\.chapter-search\s*\{[^}]*\}/, `.chapter-search {
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
  transition:
    box-shadow 0.3s ease-in-out,
    background-color 0.3s ease-in-out;
}`);

// 3. Append the unified controls, dropdowns, button colors, and typography rules from controls.css
const controlsUnified = `
/* -------------------------------------------------------------------------
   Controls & Shared Neutral Interaction States (Merged from controls.css)
   ------------------------------------------------------------------------- */

/* Universal button styles (border: none, radius 7px max, var(--soft) background, 0.3s ease-in-out transition) */
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
  transition:
    background-color 0.3s ease-in-out,
    color 0.3s ease-in-out,
    border-color 0.3s ease-in-out,
    box-shadow 0.3s ease-in-out,
    stroke 0.3s ease-in-out,
    fill 0.3s ease-in-out;
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

/* Delete, trash, and close button rules:
   Light mode: default background var(--soft), red text/icon (#dc2626); on hover background #dc2626, white text/icon (#ffffff).
   Dark mode: default background var(--soft), red text/icon (#7f1d1d); on hover background #b91c1c, white text/icon (#ffffff).
   Transition: 0.3s ease-in-out.
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
  border-radius: var(--control-radius);
  transition:
    background-color 0.3s ease-in-out,
    color 0.3s ease-in-out,
    border-color 0.3s ease-in-out,
    box-shadow 0.3s ease-in-out,
    stroke 0.3s ease-in-out,
    fill 0.3s ease-in-out;
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
  transition:
    color 0.3s ease-in-out,
    stroke 0.3s ease-in-out;
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

/* Dropdown menus & popovers: edge-to-edge items, bottom borders, no 4-sided border, radius 7px max */
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
  transition:
    background-color 0.3s ease-in-out,
    color 0.3s ease-in-out,
    border-color 0.3s ease-in-out,
    box-shadow 0.3s ease-in-out,
    stroke 0.3s ease-in-out,
    fill 0.3s ease-in-out;
}

.dropdown-item:last-child,
.menu-popover button:last-child,
.menu-popover a:last-child {
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

/* Modals & Settings Panel: eliminate 4-sided borders; max 7px radius; subtle shadow */
.tabbed-modal,
.settings-panel,
.tabbed-modal.settings-panel,
.shortcuts-modal,
.import-modal,
.confirm-modal,
.import-success-modal {
  border: none !important;
  border-radius: var(--control-radius);
  box-shadow: var(--floating-shadow);
}

.settings-tabs button {
  border-radius: var(--control-radius);
  transition:
    background-color 0.3s ease-in-out,
    color 0.3s ease-in-out;
}

.settings-tabs button:hover {
  background: var(--extra-soft);
  color: var(--text);
}

.settings-tabs button[aria-selected='true'] {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
}

.storage-stats {
  border: none !important;
  background: var(--soft);
  border-radius: var(--control-radius);
}

/* Cards & Overview: eliminate 4-sided borders; max 7px radius; subtle shadow */
.chapter-card {
  border: none !important;
  border-radius: var(--control-radius);
  box-shadow: var(--card-shadow);
  transition:
    box-shadow 0.3s ease-in-out,
    background-color 0.3s ease-in-out;
}

.chapter-card:hover,
.chapter-card[aria-current] {
  box-shadow: var(--card-hover-shadow);
  background: var(--soft);
}

.chapter-search {
  border: none !important;
  border-radius: var(--control-radius);
  background: var(--soft);
  box-shadow: var(--card-shadow);
}

.chapter-search:focus-within {
  box-shadow: var(--card-hover-shadow);
  outline: 2px solid var(--line-focus);
  outline-offset: 1px;
}

.manga-overview .cover {
  border-radius: var(--control-radius);
  border: none !important;
}

/* Shelf toolbar, shelf sort, edge progress */
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

.shelf-sort.bookmark-sort {
  margin-left: auto;
}

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

/* Bookmark Section & Track */
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

/* Import Success Modal */
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

/* Modal Typography & Headings */
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
}

/* Typography Font-Size Hierarchy & Proportional Icon Scaling */
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

/* Responsive Media Queries from controls.css */
@media (max-width: 800px) {
  :root {
    --control-size: 40px;
  }
}

@media (pointer: coarse) and (min-width: 400px) {
  :root {
    --control-size: 44px;
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

@media (max-width: 600px) {
  .shelf-toolbar {
    align-items: flex-start;
    flex-direction: column;
    gap: 16px;
  }

  .shelf-sort {
    align-self: flex-end;
  }
}

@media (max-width: 390px) {
  .upload-zone .upload-buttons {
    grid-template-columns: 1fr;
    width: min(100%, 240px);
    gap: 10px;
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
`;

const finalCss = style + '\n' + controlsUnified;
fs.writeFileSync('src/style.css', finalCss, 'utf-8');
console.log('Final merged src/style.css written. Length:', finalCss.length);
