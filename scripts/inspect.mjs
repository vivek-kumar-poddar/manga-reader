import fs from 'fs';

const styleRaw = fs.readFileSync('src/style.css', 'utf-8');
const controlsRaw = fs.readFileSync('src/controls.css', 'utf-8');

// Let's inspect all parts of styleRaw up to line 2880
const styleParts = styleRaw.split('/* Neutral themes: fixed control borders, shadow-only raised surfaces. */');
console.log('Part 1 lines:', styleParts[0].split('\n').length);
console.log('Part 2 lines:', styleParts[1] ? styleParts[1].split('\n').length : 0);
