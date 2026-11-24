// Run with: npm test (no database needed for this file).
// Enforces the project rule: every fixed rule lives in src/config/constants.js.
// Roles, statuses and similar values written as text anywhere else fail this test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../src/config/constants.js';
import { sortColumns } from '../src/utils/sql.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

// Folders written by this team. src/db/ and database.service belong to other developers.
const CHECKED = ['routes/', 'controllers/', 'middleware/', 'validators/', 'utils/', 'services/', 'app.js', 'server.js'];
const OTHER_TEAMS = ['services/database.service.js'];

// Fixed values that must come from constants.js, never typed as '...' text.
const FIXED = [
  ...C.ROLES, ...C.USER_STATUSES, ...C.STICKER_STATUSES, ...C.VEHICLE_TYPES, ...C.ACTIVITY_TYPES,
  ...C.SMS_PROVIDERS,
  C.SESSION_COOKIE_NAME, C.JWT_ALGORITHM, ...Object.values(C.PG_ERROR),
];

async function jsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return jsFiles(path);
    return e.name.endsWith('.js') ? [path] : [];
  }));
  return nested.flat();
}

// Code only: comments may still name values to explain them.
const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

test('roles, statuses and other fixed values are only written in config/constants.js', async () => {
  const offenders = [];
  for (const file of await jsFiles(SRC)) {
    const rel = relative(SRC, file).split(sep).join('/');
    if (!CHECKED.some((p) => rel.startsWith(p)) || OTHER_TEAMS.includes(rel)) continue;
    const code = withoutComments(await readFile(file, 'utf8'));
    for (const value of FIXED) {
      if (code.includes(`'${value}'`) || code.includes(`"${value}"`)) offenders.push(`${rel}: '${value}'`);
    }
  }
  assert.deepEqual(offenders, [], `Import these from config/constants.js instead:\n${offenders.join('\n')}`);
});

test('constants are frozen so no code can change them while running', () => {
  for (const [name, value] of Object.entries(C)) {
    if (value && typeof value === 'object' && !(value instanceof RegExp)) {
      assert.ok(Object.isFrozen(value), `${name} must be Object.freeze(...)`);
    }
  }
});

test('sortColumns refuses a sort field with no database column', () => {
  assert.throws(() => sortColumns(['createdAt', 'nope'], { createdAt: 'x.created_at' }), /nope/);
  assert.deepEqual(sortColumns(['a'], { a: 'x.a' }), { a: 'x.a' });
});
