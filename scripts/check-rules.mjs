import fs from 'fs';

const controls = fs.readFileSync('src/controls.css', 'utf-8');
const style = fs.readFileSync('src/style.css', 'utf-8');

// List all keyframes in style.css and controls.css
function getKeyframes(css) {
  const matches = css.match(/@keyframes\s+([a-zA-Z0-9_-]+)/g) || [];
  return matches.map(m => m.replace(/@keyframes\s+/, ''));
}

console.log('Keyframes in style:', getKeyframes(style));
console.log('Keyframes in controls:', getKeyframes(controls));

// List media queries
function getMediaQueries(css) {
  const matches = css.match(/@media[^{]+/g) || [];
  return matches.map(m => m.trim());
}

console.log('Media queries in style:', getMediaQueries(style));
console.log('Media queries in controls:', getMediaQueries(controls));

