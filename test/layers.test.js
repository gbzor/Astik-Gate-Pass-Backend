// Run with: npm test (no database needed for this file).
// Enforces the layer rule: routes -> controllers -> services -> db.
// Only files in src/services/ (and src/db/ itself) may import the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const IMPORTS_DB = /from\s+['"][^'"]*\bdb\/index\.js['"]/;

async function jsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return jsFiles(path);
    return e.name.endsWith('.js') ? [path] : [];
  }));
  return nested.flat();
}

test('only services (and db itself) import the database', async () => {
  const offenders = [];
  for (const file of await jsFiles(SRC)) {
    const rel = relative(SRC, file).split(sep).join('/');
    if (rel.startsWith('services/') || rel.startsWith('db/')) continue;
    if (IMPORTS_DB.test(await readFile(file, 'utf8'))) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `These files must call a service instead of src/db: ${offenders.join(', ')}`);
});
