import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const guards = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const settingsMerge = path.join(guards, 'settings-merge.mjs');
const installGitHooks = path.join(guards, 'install-git-hooks.mjs');
const preCommit = path.join(guards, 'git-hooks', 'pre-commit');

function temporary(prefix = 'guards-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(file, args, options = {}) {
  return spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', ...options });
}

test('settings merge installs once and restores an existing file byte for byte', () => {
  const root = temporary();
  const settings = path.join(root, 'settings.json');
  const original = '{\n  "hooks": { "SessionStart": [] },\n  "name": "sample"\n}\n';
  fs.writeFileSync(settings, original);
  const argumentsList = ['--settings', settings, '--guards-dir', guards];
  const installed = run(settingsMerge, ['--install', ...argumentsList]);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(fs.readFileSync(settings, 'utf8'), /# youcloned/);
  const firstInstall = fs.readFileSync(settings);
  const repeated = run(settingsMerge, ['--install', ...argumentsList]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(fs.readFileSync(settings), firstInstall);
  const removed = run(settingsMerge, ['--uninstall', ...argumentsList]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(fs.readFileSync(settings), Buffer.from(original));
});

test('settings merge refuses invalid JSON without changing it', () => {
  const root = temporary();
  const settings = path.join(root, 'settings.json');
  fs.writeFileSync(settings, '{ invalid');
  const result = run(settingsMerge, ['--install', '--settings', settings, '--guards-dir', guards]);
  assert.equal(result.status, 2);
  assert.deepEqual(fs.readFileSync(settings), Buffer.from('{ invalid'));
});

test('git hook installer is idempotent and reversible', () => {
  const home = temporary();
  const globalConfig = path.join(home, 'gitconfig');
  const environment = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: globalConfig };
  const installed = run(installGitHooks, ['--install'], { env: environment });
  assert.equal(installed.status, 0, installed.stderr);
  const hookDirectory = path.join(home, '.youcloned', 'git-hooks');
  assert.equal(fs.existsSync(path.join(hookDirectory, 'pre-commit')), true);
  const state = fs.readFileSync(path.join(hookDirectory, '.youcloned-install-state.json'));
  const repeated = run(installGitHooks, ['--install'], { env: environment });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(fs.readFileSync(path.join(hookDirectory, '.youcloned-install-state.json')), state);
  const removed = run(installGitHooks, ['--uninstall'], { env: environment });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(path.join(hookDirectory, 'pre-commit')), false);
  const configured = spawnSync('git', ['config', '--global', '--get', 'core.hooksPath'], { env: environment, encoding: 'utf8' });
  assert.notEqual(configured.status, 0);
});

test('pre-commit blocks staged secrets and allows a clean commit', () => {
  const blockedRepository = temporary();
  spawnSync('git', ['init', '-q'], { cwd: blockedRepository });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: blockedRepository });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: blockedRepository });
  spawnSync('git', ['config', 'core.hooksPath', path.join(guards, 'git-hooks')], { cwd: blockedRepository });
  const key = 'xoxb-' + 'M'.repeat(20);
  fs.writeFileSync(path.join(blockedRepository, 'fixture.txt'), key);
  spawnSync('git', ['add', 'fixture.txt'], { cwd: blockedRepository });
  const blocked = spawnSync('git', ['commit', '-m', 'blocked'], { cwd: blockedRepository, encoding: 'utf8' });
  assert.notEqual(blocked.status, 0);
  assert.ok(!(blocked.stdout + blocked.stderr).includes(key));

  const cleanRepository = temporary();
  spawnSync('git', ['init', '-q'], { cwd: cleanRepository });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: cleanRepository });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: cleanRepository });
  spawnSync('git', ['config', 'core.hooksPath', path.join(guards, 'git-hooks')], { cwd: cleanRepository });
  fs.writeFileSync(path.join(cleanRepository, 'fixture.txt'), 'clean staged content\n');
  spawnSync('git', ['add', 'fixture.txt'], { cwd: cleanRepository });
  const clean = spawnSync('git', ['commit', '-m', 'clean'], { cwd: cleanRepository, encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(fs.existsSync(preCommit), true);
});

test('installed hooks find Node with no node on PATH', () => {
  const home = temporary();
  const globalConfig = path.join(home, 'gitconfig');
  const environment = { HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: globalConfig, PATH: '/usr/bin:/bin' };
  const installed = run(installGitHooks, ['--install'], { env: environment });
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(fs.readFileSync(path.join(home, '.youcloned', 'lib', 'node-path'), 'utf8').trim(), process.execPath);
  const repository = temporary();
  for (const args of [['init', '-q'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test User']]) {
    spawnSync('git', args, { cwd: repository, env: environment });
  }
  fs.writeFileSync(path.join(repository, 'fixture.txt'), 'xoxb-' + 'M'.repeat(20));
  spawnSync('git', ['add', 'fixture.txt'], { cwd: repository, env: environment });
  const blocked = spawnSync('git', ['commit', '-m', 'blocked'], { cwd: repository, env: environment, encoding: 'utf8' });
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /secret-shaped value/);
  assert.doesNotMatch(blocked.stderr, /could not find Node|not found/);
  fs.writeFileSync(path.join(repository, 'fixture.txt'), 'clean staged content\n');
  spawnSync('git', ['add', 'fixture.txt'], { cwd: repository, env: environment });
  const clean = spawnSync('git', ['commit', '-m', 'clean'], { cwd: repository, env: environment, encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
  const removed = run(installGitHooks, ['--uninstall'], { env: environment });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(path.join(home, '.youcloned', 'lib', 'node-path')), false);
});
