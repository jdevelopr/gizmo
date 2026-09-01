/**
 * lint.mjs — will every module actually parse in a browser?
 *
 * `node --check` on a `.js` file parses it as CommonJS, where a template literal
 * closed with the wrong quote can slip through and then break the page on load.
 * Copying each file to `.mjs` first makes Node parse it as a module, which is the
 * only parse that matches the browser's — and it is the parse that matters,
 * because a syntax error in a module takes the whole page down silently.
 *
 *   node tools/lint.mjs
 */
import { readdirSync, copyFileSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const jsDir = fileURLToPath(new URL('../js/', import.meta.url));
const files = readdirSync(jsDir).filter(f => f.endsWith('.js')).sort();
const tmp = mkdtempSync(join(tmpdir(), 'gizmo3-lint-'));

let bad = 0;
for (const f of files) {
  const to = join(tmp, basename(f, '.js') + '.mjs');
  copyFileSync(join(jsDir, f), to);
  try {
    execFileSync(process.execPath, ['--check', to], { stdio: 'pipe' });
    console.log(`  ok    ${f}`);
  } catch (e) {
    bad++;
    console.log(`  FAIL  ${f}\n${String(e.stderr || e.message).trim().split('\n').slice(0, 6).map(l => '        ' + l).join('\n')}`);
  }
}
rmSync(tmp, { recursive: true, force: true });

console.log(bad ? `\n${bad} file(s) will not parse.` : `\n${files.length} modules parse as modules.`);
process.exit(bad ? 1 : 0);
