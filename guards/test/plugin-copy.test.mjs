// The add-on ships its own copy of the Git key check (youcloned/setup/guards) for setup's Protection
// step. The copy must match this pack byte for byte, so a fix here never misses buyers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pack = path.resolve(here, '..');
const copy = path.resolve(here, '..', '..', 'youcloned', 'setup', 'guards');

for (const file of ['install-git-hooks.mjs', 'git-hooks/pre-commit', 'git-hooks/pre-push', 'lib/secret-rules.mjs']) {
  test(`the add-on's copy of ${file} matches the guards pack`, () => {
    assert.deepEqual(fs.readFileSync(path.join(copy, file)), fs.readFileSync(path.join(pack, file)));
  });
}
