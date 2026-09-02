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
import { readdirSync, copyFileSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
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

/*
 * Does every named import actually exist?
 *
 * A missing export is not a syntax error — every file parses perfectly — and the
 * browser only finds out at load time, when it refuses the whole module graph and
 * leaves a blank page. It is exactly the failure a search-and-replace edit causes,
 * and it is exactly the one `node --check` cannot see, so it is checked here by
 * reading what each file exports and what its neighbours ask it for.
 */
const exportsOf = src => {
  const out = new Set();
  const add = n => { if (n) out.add(n.trim()); };
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+\*?([A-Za-z0-9_$]+)/gm)) add(m[1]);
  for (const m of src.matchAll(/^export\s+class\s+([A-Za-z0-9_$]+)/gm)) add(m[1]);
  // `export const a = 1, b = 2;` — every declarator on the line, not just the first.
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+(.+)$/gm)) {
    for (const d of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:=|,|$)/g)) add(d[1]);
  }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) add((part.split(/\s+as\s+/).pop() || '').trim());
  }
  return out;
};

const sources = new Map();
for (const f of files) sources.set(f, readFileSync(join(jsDir, f), 'utf8'));

// The harnesses import the same modules and break in the same way, so they are
// checked too — a tool that will not start is a test that silently stops running.
const toolDir = fileURLToPath(new URL('.', import.meta.url));
const checked = new Map(sources);
for (const f of readdirSync(toolDir).filter(n => n.endsWith('.mjs')).sort()) {
  checked.set('tools/' + f, readFileSync(join(toolDir, f), 'utf8'));
}

let missing = 0;
for (const [file, src] of checked) {
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:\.\.\/js|\.)\/([^'"]+)['"]/g)) {
    const from = m[2];
    if (!sources.has(from)) { missing++; console.log(`  MISS  ${file} imports from ${from}, which is not there`); continue; }
    const have = exportsOf(sources.get(from));
    for (const raw of m[1].split(',')) {
      const name = raw.split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      if (!have.has(name)) {
        missing++;
        console.log(`  MISS  ${file} imports { ${name} } from ${from}, which does not export it`);
      }
    }
  }
}
if (!missing) console.log(`  ok    every named import resolves`);

console.log(bad || missing
  ? `\n${bad} file(s) will not parse, ${missing} import(s) do not resolve.`
  : `\n${files.length} modules parse, and every import between them resolves.`);
process.exit(bad || missing ? 1 : 0);
