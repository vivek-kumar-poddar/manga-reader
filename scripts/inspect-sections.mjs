import fs from 'fs';

const style = fs.readFileSync('src/style.css', 'utf-8');
const lines = style.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (line.startsWith('/*') && line.endsWith('*/')) {
    console.log(`L${i + 1}: ${line}`);
  } else if (line.startsWith('/*')) {
    console.log(`L${i + 1}: ${line}`);
  }
}

