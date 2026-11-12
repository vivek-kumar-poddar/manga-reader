import fs from 'fs';

const controls = fs.readFileSync('src/controls.css', 'utf-8');

// Parse controls.css into top-level blocks
function parseBlocks(css) {
  const blocks = [];
  let depth = 0;
  let start = 0;
  let selector = '';
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      if (depth === 0) {
        selector = css.slice(start, i).trim();
        start = i;
      }
      depth++;
    } else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        const body = css.slice(start + 1, i).trim();
        blocks.push({ selector, body, full: css.slice(start, i + 1) });
        start = i + 1;
      }
    }
  }
  return blocks;
}

const blocks = parseBlocks(controls);
console.log('Total top-level blocks in controls.css:', blocks.length);
blocks.forEach((b, idx) => {
  console.log(`[${idx}] ${b.selector.replace(/\n/g, ' ')}`);
});
