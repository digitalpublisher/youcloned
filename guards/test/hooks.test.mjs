// The Git key check must fire: every pushed commit is scanned, an existing hook folder still runs the
// YouCloned check first, and --verify only passes when a planted test key is refused.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const guards = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const installGitHooks = path.join(guards, 'install-git-hooks.mjs');
const packHooks = path.join(guards, 'git-hooks');
const fakeKey = () => 'xoxb-' + 'P'.repeat(22);

function temporary(prefix = 'guards-hooks-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sandbox() {
  const home = temporary();
  return { home, env: { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } };
}

function git(cwd, args, env, input) {
  return spawnSync('git', args, { cwd, env, encoding: 'utf8', input });
}

function repository(env, hooksPath) {
  const root = temporary();
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test User']]) git(root, args, env);
  if (hooksPath) git(root, ['config', 'core.hooksPath', hooksPath], env);
  return root;
}

function commit(root, file, contents, env, extra = []) {
  fs.writeFileSync(path.join(root, file), contents);
  git(root, ['add', '-A'], env);
  return git(root, ['commit', '-q', ...extra, '-m', `change ${file}`], env);
}

function remove(root, file, env) {
  fs.rmSync(path.join(root, file));
  git(root, ['add', '-A'], env);
  return git(root, ['commit', '-q', '-m', `remove ${file}`], env);
}

function bareRemote(env) {
  const bare = temporary();
  git(bare, ['init', '-q', '--bare'], env);
  return bare;
}

test('pre-push blocks a key committed in an earlier commit and deleted later, on a new branch', () => {
  const { env } = sandbox();
  const root = repository(env, packHooks);
  const remote = bareRemote(env);
  git(root, ['remote', 'add', 'origin', remote], env);
  assert.equal(commit(root, 'notes.txt', 'clean\n', env).status, 0);
  assert.equal(commit(root, 'leak.txt', fakeKey(), env, ['--no-verify']).status, 0);
  assert.equal(remove(root, 'leak.txt', env).status, 0);
  const pushed = git(root, ['push', '-q', 'origin', 'HEAD:main'], env);
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /secret-shaped value/);
  assert.ok(!(pushed.stdout + pushed.stderr).includes(fakeKey()));
  assert.notEqual(git(remote, ['rev-parse', '--verify', '-q', 'refs/heads/main'], env).status, 0);
});

test('pre-push blocks a deleted key inside the pushed range of an existing branch', () => {
  const { env } = sandbox();
  const root = repository(env, packHooks);
  const remote = bareRemote(env);
  git(root, ['remote', 'add', 'origin', remote], env);
  commit(root, 'notes.txt', 'clean\n', env);
  assert.equal(git(root, ['push', '-q', 'origin', 'HEAD:main'], env).status, 0);
  commit(root, 'leak.txt', fakeKey(), env, ['--no-verify']);
  remove(root, 'leak.txt', env);
  commit(root, 'more.txt', 'still clean\n', env);
  const pushed = git(root, ['push', '-q', 'origin', 'HEAD:main'], env);
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /secret-shaped value/);
  assert.ok(!(pushed.stdout + pushed.stderr).includes(fakeKey()));
});

test('pre-push blocks a key that is only in a commit message', () => {
  const { env } = sandbox();
  const root = repository(env, packHooks);
  const remote = bareRemote(env);
  git(root, ['remote', 'add', 'origin', remote], env);
  fs.writeFileSync(path.join(root, 'notes.txt'), 'clean\n');
  git(root, ['add', '-A'], env);
  git(root, ['commit', '-q', '--no-verify', '-m', `note ${fakeKey()}`], env);
  const pushed = git(root, ['push', '-q', 'origin', 'HEAD:main'], env);
  assert.notEqual(pushed.status, 0);
  assert.ok(!(pushed.stdout + pushed.stderr).includes(fakeKey()));
});

test('pre-push allows a clean push and only scans what the remote does not have yet', () => {
  const { env } = sandbox();
  const root = repository(env, packHooks);
  const remote = bareRemote(env);
  git(root, ['remote', 'add', 'origin', remote], env);
  commit(root, 'old.txt', fakeKey(), env, ['--no-verify']);
  assert.equal(git(root, ['push', '-q', '--no-verify', 'origin', 'HEAD:main'], env).status, 0);
  git(root, ['fetch', '-q', 'origin'], env);
  commit(root, 'new.txt', 'clean\n', env);
  const pushed = git(root, ['push', '-q', 'origin', 'HEAD:main'], env);
  assert.equal(pushed.status, 0, pushed.stderr);
  const branch = git(root, ['push', '-q', 'origin', 'HEAD:other'], env);
  assert.equal(branch.status, 0, branch.stderr);
});

test('an existing global hooks folder: the YouCloned check runs first and the old hook still runs', () => {
  const { home, env } = sandbox();
  const existing = path.join(home, 'my-hooks');
  fs.mkdirSync(existing);
  const ran = path.join(home, 'ran');
  const originalCommit = `#!/bin/sh\necho commit >> "${ran}"\nexit 0\n`;
  const originalPush = `#!/bin/sh\ncat >> "${ran}"\nexit 0\n`;
  fs.writeFileSync(path.join(existing, 'pre-commit'), originalCommit, { mode: 0o755 });
  fs.writeFileSync(path.join(existing, 'pre-push'), originalPush, { mode: 0o755 });
  git(home, ['config', '--global', 'core.hooksPath', existing], env);
  const installed = spawnSync(process.execPath, [installGitHooks, '--install'], { env, encoding: 'utf8' });
  assert.equal(installed.status, 0, installed.stderr);

  const root = repository(env);
  const blocked = commit(root, 'leak.txt', fakeKey(), env);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /secret-shaped value/);
  assert.equal(fs.existsSync(ran), false, 'the old hook must not run after the YouCloned check refused');

  fs.rmSync(path.join(root, 'leak.txt'));
  git(root, ['reset', '-q'], env);
  assert.equal(commit(root, 'notes.txt', 'clean\n', env).status, 0);
  assert.match(fs.readFileSync(ran, 'utf8'), /commit/);
  const remote = bareRemote(env);
  git(root, ['remote', 'add', 'origin', remote], env);
  assert.equal(git(root, ['push', '-q', 'origin', 'HEAD:main'], env).status, 0);
  assert.match(fs.readFileSync(ran, 'utf8'), /refs\/heads\/main/, 'the old pre-push hook still gets the pushed refs');

  const verified = spawnSync(process.execPath, [installGitHooks, '--verify'], { env, encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.match(verified.stdout, /PROTECTION PROVEN/);

  const removed = spawnSync(process.execPath, [installGitHooks, '--uninstall'], { env, encoding: 'utf8' });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.readFileSync(path.join(existing, 'pre-commit'), 'utf8'), originalCommit);
  assert.equal(fs.readFileSync(path.join(existing, 'pre-push'), 'utf8'), originalPush);
  assert.deepEqual(fs.readdirSync(existing).sort(), ['pre-commit', 'pre-push']);
});

test('an old append-style install after "exit 0" is replaced by the wrapper on the next install', () => {
  const { home, env } = sandbox();
  const existing = path.join(home, 'my-hooks');
  const target = path.join(home, '.youcloned', 'git-hooks');
  fs.mkdirSync(existing);
  fs.mkdirSync(target, { recursive: true });
  const original = '#!/bin/sh\nexit 0\n';
  const chains = [];
  for (const name of ['pre-commit', 'pre-push']) {
    const file = path.join(existing, name);
    fs.writeFileSync(file, `${original}# youcloned hooks begin\n"$HOME/.youcloned/git-hooks/${name}"\n# youcloned hooks end\n`, { mode: 0o755 });
    chains.push({ file, original: Buffer.from(original).toString('base64') });
  }
  fs.writeFileSync(path.join(target, '.youcloned-install-state.json'), JSON.stringify({ mode: 'chain', originalHooksPath: existing, chains }));
  git(home, ['config', '--global', 'core.hooksPath', existing], env);

  const root = repository(env);
  fs.cpSync(packHooks, target, { recursive: true });
  fs.mkdirSync(path.join(home, '.youcloned', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(guards, 'lib', 'secret-rules.mjs'), path.join(home, '.youcloned', 'lib', 'secret-rules.mjs'));
  assert.equal(commit(root, 'leak.txt', fakeKey(), env).status, 0, 'the old install never ran the check');

  const installed = spawnSync(process.execPath, [installGitHooks, '--install'], { env, encoding: 'utf8' });
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(fs.readFileSync(path.join(existing, 'pre-commit.youcloned-chained'), 'utf8'), original);
  const blocked = commit(root, 'leak2.txt', fakeKey(), env);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /secret-shaped value/);
});

test('--verify fails with no install, and reports a repository-local hooks folder', () => {
  const { home, env } = sandbox();
  const none = spawnSync(process.execPath, [installGitHooks, '--verify'], { env, encoding: 'utf8' });
  assert.equal(none.status, 1);
  assert.match(none.stdout, /PROTECTION NOT PROVEN/);

  assert.equal(spawnSync(process.execPath, [installGitHooks, '--install'], { env, encoding: 'utf8' }).status, 0);
  const own = path.join(home, 'repo-hooks');
  fs.mkdirSync(own);
  const root = repository(env, own);
  const local = spawnSync(process.execPath, [installGitHooks, '--verify', root], { env, encoding: 'utf8' });
  assert.equal(local.status, 1);
  assert.match(local.stdout, /PROTECTION NOT PROVEN/);
  assert.match(local.stdout, /core\.hooksPath = /);
  assert.ok(!local.stdout.includes('xoxb-youcloned'));
});

test('--verify on a protected repository proves it without committing or staging anything', () => {
  const { env } = sandbox();
  assert.equal(spawnSync(process.execPath, [installGitHooks, '--install'], { env, encoding: 'utf8' }).status, 0);
  const root = repository(env);
  commit(root, 'notes.txt', 'clean\n', env);
  const head = git(root, ['rev-parse', 'HEAD'], env).stdout;
  const verified = spawnSync(process.execPath, [installGitHooks, '--verify', root], { env, encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.match(verified.stdout, /PROTECTION PROVEN/);
  assert.equal(git(root, ['rev-parse', 'HEAD'], env).stdout, head);
  assert.equal(git(root, ['status', '--porcelain'], env).stdout, '');
  const throwaway = spawnSync(process.execPath, [installGitHooks, '--verify'], { env, encoding: 'utf8' });
  assert.equal(throwaway.status, 0, throwaway.stdout + throwaway.stderr);
});

test('pre-push scans history the push URL lacks even when the fetch remote already has it', () => {
  const { env } = sandbox();
  const root = repository(env, packHooks);
  const fetchSide = bareRemote(env);
  const pushSide = bareRemote(env);
  git(root, ['remote', 'add', 'origin', fetchSide], env);
  commit(root, 'leak.txt', fakeKey(), env, ['--no-verify']);
  remove(root, 'leak.txt', env);
  assert.equal(git(root, ['push', '-q', '--no-verify', 'origin', 'HEAD:main'], env).status, 0);
  git(root, ['fetch', '-q', 'origin'], env);
  git(root, ['remote', 'set-url', '--push', 'origin', pushSide], env);
  commit(root, 'more.txt', 'clean\n', env);
  const pushed = git(root, ['push', '-q', 'origin', 'HEAD:fresh'], env);
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /secret-shaped value/);
  assert.ok(!(pushed.stdout + pushed.stderr).includes(fakeKey()));
  assert.notEqual(git(pushSide, ['rev-parse', '--verify', '-q', 'refs/heads/fresh'], env).status, 0);
});

test('pre-push scans the whole pushed history when the push URL cannot be asked what it holds', () => {
  const { env } = sandbox();
  const root = repository(env, packHooks);
  const fetchSide = bareRemote(env);
  git(root, ['remote', 'add', 'origin', fetchSide], env);
  commit(root, 'leak.txt', fakeKey(), env, ['--no-verify']);
  remove(root, 'leak.txt', env);
  assert.equal(git(root, ['push', '-q', '--no-verify', 'origin', 'HEAD:main'], env).status, 0);
  git(root, ['fetch', '-q', 'origin'], env);
  const head = git(root, ['rev-parse', 'HEAD'], env).stdout.trim();
  const zero = '0'.repeat(40);
  const unreachable = path.join(temporary(), 'missing.git');
  const input = `refs/heads/main ${head} refs/heads/main ${zero}\n`;
  const run = spawnSync('sh', [path.join(packHooks, 'pre-push'), 'origin', unreachable], { cwd: root, env, encoding: 'utf8', input });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /secret-shaped value/);
  assert.ok(!(run.stdout + run.stderr).includes(fakeKey()));
  assert.ok(!(run.stdout + run.stderr).includes(unreachable), 'the push URL is never printed');

  const clean = repository(env, packHooks);
  commit(clean, 'notes.txt', 'clean\n', env);
  const cleanHead = git(clean, ['rev-parse', 'HEAD'], env).stdout.trim();
  const ok = spawnSync('sh', [path.join(packHooks, 'pre-push'), 'origin', unreachable], { cwd: clean, env, encoding: 'utf8', input: `refs/heads/main ${cleanHead} refs/heads/main ${zero}\n` });
  assert.equal(ok.status, 0, ok.stderr);
});

test('--verify fails when only the push check is missing, and says so', () => {
  const { home, env } = sandbox();
  assert.equal(spawnSync(process.execPath, [installGitHooks, '--install'], { env, encoding: 'utf8' }).status, 0);
  fs.writeFileSync(path.join(home, '.youcloned', 'git-hooks', 'pre-push'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const verified = spawnSync(process.execPath, [installGitHooks, '--verify'], { env, encoding: 'utf8' });
  assert.equal(verified.status, 1);
  assert.match(verified.stdout, /PROTECTION NOT PROVEN/);
  assert.match(verified.stdout, /in a push/);
  assert.doesNotMatch(verified.stdout, /a commit and/);
  assert.ok(!verified.stdout.includes('xoxb-youcloned'));
});

test('--verify on a repository uses its own hooks folder and leaves no objects, refs or worktrees behind', () => {
  const { home, env } = sandbox();
  assert.equal(spawnSync(process.execPath, [installGitHooks, '--install'], { env, encoding: 'utf8' }).status, 0);
  const root = repository(env);
  commit(root, 'notes.txt', 'clean\n', env);
  const before = {
    refs: git(root, ['for-each-ref'], env).stdout,
    objects: git(root, ['count-objects', '-v'], env).stdout,
    worktrees: git(root, ['worktree', 'list', '--porcelain'], env).stdout,
  };
  const proven = spawnSync(process.execPath, [installGitHooks, '--verify', root], { env, encoding: 'utf8' });
  assert.equal(proven.status, 0, proven.stdout + proven.stderr);
  assert.match(proven.stdout, /in a commit, and refused a push/);
  assert.deepEqual({
    refs: git(root, ['for-each-ref'], env).stdout,
    objects: git(root, ['count-objects', '-v'], env).stdout,
    worktrees: git(root, ['worktree', 'list', '--porcelain'], env).stdout,
  }, before);
  assert.equal(git(root, ['status', '--porcelain'], env).stdout, '');

  // A repository-local hooks folder replaces the computer-wide one: the global check passes, this one fails.
  const own = path.join(home, 'repo-hooks');
  fs.mkdirSync(own);
  fs.writeFileSync(path.join(own, 'pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  git(root, ['config', 'core.hooksPath', own], env);
  assert.equal(spawnSync(process.execPath, [installGitHooks, '--verify'], { env, encoding: 'utf8' }).status, 0);
  const bypassed = spawnSync(process.execPath, [installGitHooks, '--verify', root], { env, encoding: 'utf8' });
  assert.equal(bypassed.status, 1);
  assert.match(bypassed.stdout, /PROTECTION NOT PROVEN/);
  assert.match(bypassed.stdout, /sets its own hooks folder/);
  assert.match(bypassed.stdout, /skips the computer-wide YouCloned check/);

  // Pointing that setting at the YouCloned folder is protected, and the note says the check still runs.
  git(root, ['config', 'core.hooksPath', path.join(home, '.youcloned', 'git-hooks')], env);
  const pointed = spawnSync(process.execPath, [installGitHooks, '--verify', root], { env, encoding: 'utf8' });
  assert.equal(pointed.status, 0, pointed.stdout + pointed.stderr);
  assert.match(pointed.stdout, /check still runs there/);
});

test('--install repairs protection after another tool changes or removes the global hooks path', () => {
  const { home, env } = sandbox();
  const target = path.join(home, '.youcloned', 'git-hooks');
  assert.equal(spawnSync(process.execPath, [installGitHooks, '--install'], { env, encoding: 'utf8' }).status, 0);

  // Another tool points Git at its own folder.
  const other = path.join(home, 'other-tool-hooks');
  fs.mkdirSync(other);
  const ran = path.join(home, 'ran');
  const otherCommit = `#!/bin/sh\necho other >> "${ran}"\nexit 0\n`;
  fs.writeFileSync(path.join(other, 'pre-commit'), otherCommit, { mode: 0o755 });
  git(home, ['config', '--global', 'core.hooksPath', other], env);
  assert.equal(spawnSync(process.execPath, [installGitHooks, '--verify'], { env, encoding: 'utf8' }).status, 1);

  const repaired = spawnSync(process.execPath, [installGitHooks, '--install'], { env, encoding: 'utf8' });
  assert.equal(repaired.status, 0, repaired.stderr);
  const verified = spawnSync(process.execPath, [installGitHooks, '--verify'], { env, encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  const root = repository(env);
  assert.equal(commit(root, 'notes.txt', 'clean\n', env).status, 0);
  assert.match(fs.readFileSync(ran, 'utf8'), /other/, 'the other tool\'s hook still runs after the YouCloned check');

  // The other tool removes the setting: --install points Git back at the YouCloned folder.
  git(home, ['config', '--global', '--unset-all', 'core.hooksPath'], env);
  assert.equal(spawnSync(process.execPath, [installGitHooks, '--verify'], { env, encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, [installGitHooks, '--install'], { env, encoding: 'utf8' }).status, 0);
  assert.equal(git(home, ['config', '--global', '--get', 'core.hooksPath'], env).stdout.trim(), target);
  assert.equal(fs.readFileSync(path.join(other, 'pre-commit'), 'utf8'), otherCommit, 'the folder that was left is put back');
  assert.deepEqual(fs.readdirSync(other), ['pre-commit']);
  assert.equal(spawnSync(process.execPath, [installGitHooks, '--verify'], { env, encoding: 'utf8' }).status, 0);

  // A hook file deleted by hand is copied back too.
  fs.rmSync(path.join(target, 'pre-push'));
  assert.equal(spawnSync(process.execPath, [installGitHooks, '--install'], { env, encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync(process.execPath, [installGitHooks, '--verify'], { env, encoding: 'utf8' }).status, 0);

  assert.equal(spawnSync(process.execPath, [installGitHooks, '--uninstall'], { env, encoding: 'utf8' }).status, 0);
  assert.notEqual(git(home, ['config', '--global', '--get', 'core.hooksPath'], env).status, 0);
});
