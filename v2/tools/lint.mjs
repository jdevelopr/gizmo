/**
 * lint.mjs — parse every module the page loads, as a module.
 *
 * `node --check file.js` parses as CommonJS, where a template literal closed with
 * the wrong quote can slip through; the browser does not. This copies each file to
 * a .mjs and checks it under real module semantics instead, which is the only
 * parse that matches what the browser will do.
 *
 *   node tools/lint.mjs
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = new URL('../js/', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'gizmo-lint-'));
let bad = 0;

for (const f of readdirSync(dir).filter(n => n.endsWith('.js')).sort()) {
  const target = join(tmp, f.replace(/\.js$/, '.mjs'));
  copyFileSync(join(dir, f), target);
  try {
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
    console.log('  ok    ' + f);
  } catch (e) {
    bad++;
    const out = String(e.stderr || e.stdout || e.message).split('\n').slice(0, 4).join('\n');
    console.log('  FAIL  ' + f + '\n' + out.replace(/^/gm, '        '));
  }
}
console.log(bad ? `\n${bad} file(s) will not parse in a browser` : '\nevery module parses');
process.exit(bad ? 1 : 0);
