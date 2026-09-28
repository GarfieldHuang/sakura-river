import * as esbuild from 'esbuild';
import fs from 'fs';
const minify = !process.argv.includes('--dev');
const r = await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', minify, write: false, target: 'es2020', legalComments: 'none', logLevel: 'warning' });
let js = r.outputFiles[0].text.replace(/<\/script/gi, '<\/script');
const html = fs.readFileSync('template.html', 'utf8').replace('/*__BUNDLE__*/', () => js);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('bytes', html.length);
