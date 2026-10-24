// Falla si algun archivo del repo contiene rayas largas (U+2014) o medias (U+2013).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const TEXT = new Set([
  '.ts',
  '.js',
  '.mjs',
  '.json',
  '.md',
  '.html',
  '.css',
  '.yml',
  '.yaml',
  '.txt',
]);
const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && f !== 'package-lock.json' && TEXT.has(extname(f)));

let bad = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if ([...line].some((ch) => ch.charCodeAt(0) === 0x2013 || ch.charCodeAt(0) === 0x2014)) {
      console.error(`${file}:${i + 1}: raya o guion largo`);
      bad++;
    }
  });
}

if (bad > 0) {
  console.error(`\n${bad} linea(s) con rayas. Usa comas, dos puntos o parentesis.`);
  process.exit(1);
}
console.info(`check:text ok (${files.length} archivos)`);
