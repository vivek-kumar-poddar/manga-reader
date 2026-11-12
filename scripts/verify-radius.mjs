import fs from 'fs';

const css = fs.readFileSync('src/style.css', 'utf-8');

const regex = /border-radius:\s*([^;]+);/g;
let match;
let violations = [];
while ((match = regex.exec(css)) !== null) {
  const val = match[1].trim();
  // check each number
  const nums = val.match(/[0-9.]+(px|%|rem|em)?/g) || [];
  for (const n of nums) {
    if (n.endsWith('px')) {
      const px = parseFloat(n);
      if (px > 7) {
        violations.push({ match: match[0], val, num: px });
      }
    } else if (n.endsWith('%')) {
      const pct = parseFloat(n);
      if (pct > 50) {
        violations.push({ match: match[0], val, num: pct });
      }
    }
  }
}

console.log('Border-radius > 7px violations:', violations.length);
if (violations.length > 0) {
  console.log(violations);
}

