import fs from 'fs';

// We'll read both files to verify all contents
const styleRaw = fs.readFileSync('src/style.css', 'utf-8');
const controlsRaw = fs.readFileSync('src/controls.css', 'utf-8');

console.log('Original style.css length:', styleRaw.length);
console.log('Original controls.css length:', controlsRaw.length);

