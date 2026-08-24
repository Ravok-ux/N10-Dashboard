// check-syntax.mjs — Verificación de sintaxis JS antes de deploy
// Usa vm.Script de Node para detectar SyntaxError reales sin ejecutar el código.
// Uso: node check-syntax.mjs

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

const JS_DIR = new URL('./js/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const files = readdirSync(JS_DIR)
  .filter(f => f.endsWith('.js') && !f.includes('.min.') && !f.startsWith('lib'))
  .map(f => ({ name: f, path: join(JS_DIR, f) }));

let errors = 0;
const warnings = [];

for (const { name, path } of files) {
  let src = readFileSync(path, 'utf8');

  // Strip ES module syntax so vm.Script can parse it
  src = src
    .replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '/* import */')
    .replace(/^import\s*\{[^}]*\}\s*from\s+['"][^'"]+['"]\s*;?\s*$/gm, '/* import */')
    .replace(/^export\s*\{[^}]*\}\s*from\s+['"][^'"]+['"]\s*;?\s*$/gm, '/* re-export */')
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '/* export */')
    .replace(/^export\s+(default\s+)?/gm, '');

  try {
    new vm.Script(src, { filename: name });
  } catch (e) {
    if (e instanceof SyntaxError) {
      console.error(`❌ ${name}:${e.lineNumber ?? '?'}: ${e.message}`);
      errors++;
    }
  }
}

if (errors > 0) {
  console.error(`\n🚫 ${errors} archivo(s) con errores de sintaxis. Deploy cancelado.`);
  process.exit(1);
} else {
  console.log(`✅ Sintaxis OK — ${files.length} archivos verificados.`);
}
