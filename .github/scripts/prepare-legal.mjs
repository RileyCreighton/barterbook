import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';
mkdirSync('dist/legal', { recursive: true });
for (const file of ['LICENSE', 'NOTICE']) copyFileSync(file, `dist/legal/${file}`);
copyFileSync('docs/third-party-licenses.txt', 'dist/legal/third-party-licenses.txt');
for (const file of readdirSync('docs/vendor')) copyFileSync(`docs/vendor/${file}`, `dist/legal/${file}`);
console.log('Copied license notices and exact LGPL dependency source to dist/legal.');
