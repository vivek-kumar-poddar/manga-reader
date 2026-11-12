import fs from 'fs';

const original = fs.readFileSync('src/style.css', 'utf-8');
const draft = fs.readFileSync('scripts/build-unified-css.mjs', 'utf-8');

function extractSelectors(css) {
  const set = new Set();
  const regex = /([^{}/]+)\{/g;
  let match;
  while ((match = regex.exec(css)) !== null) {
    const s = match[1].trim();
    if (!s.startsWith('@')) {
      s.split(',').forEach(sub => set.add(sub.trim()));
    }
  }
  return set;
}

const origS = extractSelectors(original);
const draftS = extractSelectors(draft);

const missing = [];
for (const sel of origS) {
  if (!draftS.has(sel)) {
    missing.push(sel);
  }
}

console.log('Original selectors count:', origS.size);
console.log('Draft selectors count:', draftS.size);
console.log('Missing selectors count:', missing.length);
console.log('Sample missing:', missing.slice(0, 30));

