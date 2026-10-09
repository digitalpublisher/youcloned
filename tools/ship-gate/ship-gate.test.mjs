import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const here = path.dirname(new URL(import.meta.url).pathname);
const gate = path.join(here, 'ship-gate.mjs');
const workspace = path.resolve(here, '../..');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ship-gate-'));
}

function write(root, body, name = 'fixture.txt') {
  fs.writeFileSync(path.join(root, name), body);
}

function run(root, args = [], environment = {}) {
  return spawnSync(process.execPath, [gate, root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

test('each key shape is caught and output is masked', () => {
  const root = tempDirectory();
  const fixtures = [
    ['anthropic-key', 'sk-ant-' + 'A'.repeat(20)],
    ['openai-key', 'sk-' + 'B'.repeat(24)],
    ['github-token', 'ghp_' + 'C'.repeat(24)],
    ['github-token', 'gho_' + 'D'.repeat(24)],
    ['github-token', 'ghu_' + 'E'.repeat(24)],
    ['github-token', 'ghs_' + 'F'.repeat(24)],
    ['github-token', 'ghr_' + 'G'.repeat(24)],
    ['github-token', 'github_pat_' + 'H'.repeat(24)],
    ['slack-token', 'xoxb-' + 'I'.repeat(20)],
    ['slack-token', 'xoxp-' + 'J'.repeat(20)],
    ['slack-token', 'xoxa-' + 'K'.repeat(20)],
    ['slack-token', 'xoxs-' + 'L'.repeat(20)],
    ['slack-token', 'xapp-' + 'M'.repeat(20)],
    ['aws-access-key-id', 'AKIA' + 'N'.repeat(16)],
    ['google-api-key', 'AIza' + 'O'.repeat(24)],
    ['stripe-secret-key', 'sk_live_' + 'P'.repeat(24)],
    ['stripe-secret-key', 'rk_live_' + 'Q'.repeat(24)],
    ['stripe-webhook-secret', 'whsec_' + 'R'.repeat(24)],
    ['sendgrid-key', 'SG.' + 'S'.repeat(12) + '.' + 'T'.repeat(12)],
    ['jwt', 'eyJ' + 'header.eyJ' + 'payload.signature'],
    ['pem-private-key', '-----BEGIN ' + 'PRIVATE KEY-----'],
    ['database-url-password', 'postgres' + '://user:madeuppassword@db.test/data'],
    ['database-url-password', 'postgresql' + '://user:madeuppassword@db.test/data'],
    ['database-url-password', 'mysql' + '://user:madeuppassword@db.test/data'],
    ['database-url-password', 'mongodb' + '://user:madeuppassword@db.test/data'],
    ['generic-secret-assignment', 'API_' + 'TOKEN=' + 'U7'.repeat(10)],
    ['generic-secret-assignment', 'SECRET=' + 'V8'.repeat(10)],
  ];
  write(root, fixtures.map(([, value]) => value).join('\n'));
  const result = run(root);
  assert.equal(result.status, 1);
  for (const [rule, value] of fixtures) {
    assert.match(result.stdout, new RegExp(` ${rule} `));
    assert.ok(!result.stdout.includes(value), `unmasked value leaked for ${rule}`);
  }
});

test('paths, repository denylist literals, and emails are caught', () => {
  const root = tempDirectory();
  const address = 'person' + '@' + 'buyer.test';
  write(root, '/Users/' + 'someone/project\nJON' + 'BENSON\n' + address);
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /author-machine-path/);
  assert.match(result.stdout, /denylist:repo/);
  assert.match(result.stdout, /email-address/);
  assert.ok(!result.stdout.includes(address));
});

test('private denylist matches are found without exposing the entry', () => {
  const root = tempDirectory();
  const home = tempDirectory();
  const privateValue = 'customer-' + 'amber';
  fs.mkdirSync(path.join(home, '.config/youcloned'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config/youcloned/ship-denylist.txt'), privateValue + '\n');
  write(root, 'contains ' + privateValue);
  const result = run(root, [], { HOME: home });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /denylist:private \[private\]/);
  assert.ok(!result.stdout.includes(privateValue));
});

test('placeholders and process environment references are not flagged', () => {
  const root = tempDirectory();
  write(root, [
    'API_' + 'KEY=your-key-here',
    'APP_' + 'SECRET=xxx',
    'AUTH_' + 'TOKEN=<token-name>',
    'DB_' + 'PASSWORD=${DATABASE_PASSWORD}',
    'OTHER_' + 'TOKEN=process.env.MY_TOKEN',
  ].join('\n'));
  const result = run(root);
  assert.equal(result.status, 0, result.stdout);
});

test('a clean directory exits zero', () => {
  const root = tempDirectory();
  write(root, 'A short, ordinary fixture with no buyer-specific details.\n');
  fs.writeFileSync(path.join(root, '.git'), '/Users/' + 'ignored/worktree\n');
  const result = run(root, ['--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).count, 0);
});

test('scanning this worktree root does not crash', () => {
  const result = spawnSync(process.execPath, [gate, workspace, '--json'], { encoding: 'utf8' });
  assert.notEqual(result.status, 2, result.stderr);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
});

test('the gate still runs from a folder with a space reached through a symlink', () => {
  const parent = tempDirectory();
  const spaced = path.join(parent, 'My Folder');
  fs.mkdirSync(spaced);
  for (const name of fs.readdirSync(here)) fs.copyFileSync(path.join(here, name), path.join(spaced, name));
  const linked = path.join(parent, 'linked');
  fs.symlinkSync(spaced, linked);
  const root = tempDirectory();
  write(root, 'xoxb-' + 'M'.repeat(20));
  const result = spawnSync(process.execPath, [path.join(linked, 'ship-gate.mjs'), root], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const listed = tempDirectory();
  write(listed, 'see team.bnsn.ai for details\n');
  const denied = spawnSync(process.execPath, [path.join(linked, 'ship-gate.mjs'), listed], { encoding: 'utf8', env: { ...process.env, HOME: tempDirectory() } });
  assert.equal(denied.status, 1, denied.stdout + denied.stderr);
});

test('generic secret rule catches camelCase secrets and leaves code names alone', () => {
  const caught = tempDirectory();
  write(caught, "const apiKey = '" + 'a1B2'.repeat(5) + "';\n" + 'PASSWORD=' + 'Zq'.repeat(17) + '\n');
  const hit = run(caught);
  assert.equal(hit.status, 1);
  assert.equal(hit.stdout.match(/generic-secret-assignment/g).length, 2);
  const code = tempDirectory();
  write(code, [
    "  { key: 'coursebuilder', open: 'https://app.example.com' },",
    "  { key: 'vsl-lead-writer', label: 'VSL lead' },",
    '  skillKey = !!skillKeyServer',
    "  Button({ key: 'home-skillkey-check', label: 'Done' })",
    'It becomes your Obsidian vault, where your notes live.',
  ].join('\n'));
  const clean = run(code);
  assert.equal(clean.status, 0, clean.stdout);
});
