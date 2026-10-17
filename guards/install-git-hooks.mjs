#!/usr/bin/env node
// Installs YouCloned's Git key check for every repository on this computer.
//   --install            put the hooks in place (safe to run again; it also refreshes the hook files)
//   --uninstall          put everything back the way it was
//   --verify [repo]      prove the check fires: a planted test key must be refused. With no repo it uses
//                        a throwaway one; with a repo it tests that repo without committing anything.
//                        Exit 0 only when proven. Any repository-local core.hooksPath is reported.
// With no global hooks folder, Git is pointed at ~/.youcloned/git-hooks. When the computer already has a
// global hooks folder, each hook there is moved to <name>.youcloned-chained and replaced by a small
// wrapper that runs the YouCloned check FIRST and then the original hook with the same input.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hookNames = ['pre-commit', 'pre-push'];
const markerStart = '# youcloned hooks begin';
const markerEnd = '# youcloned hooks end';
const wrapperTag = '# youcloned wrapper v2';
const chainedSuffix = '.youcloned-chained';
const stateVersion = 2;
const guardDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
const targetDirectory = path.join(home, '.youcloned', 'git-hooks');
const installedLibrary = path.join(home, '.youcloned', 'lib', 'secret-rules.mjs');
const installedNodePath = path.join(home, '.youcloned', 'lib', 'node-path');
const stateFile = path.join(targetDirectory, '.youcloned-install-state.json');

function runGit(args, options = {}) {
  return spawnSync('git', args, { encoding: 'utf8', ...options });
}

function globalHooksPath() {
  const result = runGit(['config', '--global', '--type=path', '--get', 'core.hooksPath']);
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

function samePath(a, b) {
  const resolved = (value) => { try { return fs.realpathSync(value); } catch { return path.resolve(value); } };
  return resolved(a) === resolved(b);
}

function copyHooks() {
  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(installedLibrary), { recursive: true });
  fs.copyFileSync(path.join(guardDirectory, 'lib', 'secret-rules.mjs'), installedLibrary);
  fs.writeFileSync(installedNodePath, `${process.execPath}\n`);
  for (const name of hookNames) {
    const source = path.join(guardDirectory, 'git-hooks', name);
    const destination = path.join(targetDirectory, name);
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, 0o755);
  }
}

// The wrapper keeps the hook's input (pre-push gets the pushed refs on stdin) so both checks see it.
function wrapper(name) {
  const input = name === 'pre-push';
  return [
    '#!/bin/sh',
    wrapperTag,
    `# YouCloned's key check runs first, then the hook that was here before (${name}${chainedSuffix}).`,
    ...(input ? [
      'input=$(mktemp "${TMPDIR:-/tmp}/youcloned-hook.XXXXXX") || exit 1',
      'trap \'rm -f "$input"\' EXIT HUP INT TERM',
      'cat > "$input"',
      `"$HOME/.youcloned/git-hooks/${name}" "$@" < "$input" || exit $?`,
    ] : [`"$HOME/.youcloned/git-hooks/${name}" "$@" || exit $?`]),
    `chained="$(dirname -- "$0")/${name}${chainedSuffix}"`,
    input ? 'if [ -x "$chained" ]; then "$chained" "$@" < "$input"; exit $?; fi' : 'if [ -x "$chained" ]; then exec "$chained" "$@"; fi',
    'exit 0',
    '',
  ].join('\n');
}

function removeBlock(text) {
  const pattern = new RegExp(`(?:\\r?\\n)?${markerStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${markerEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\r?\\n)?`, 'g');
  return text.replace(pattern, '');
}

function isWrapper(file) {
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(wrapperTag);
}

function wrapHook(directory, name) {
  const file = path.join(directory, name);
  const chained = `${file}${chainedSuffix}`;
  fs.mkdirSync(directory, { recursive: true });
  if (isWrapper(file)) return { file, chained: fs.existsSync(chained) };
  let hasChained = false;
  if (fs.existsSync(file)) {
    if (fs.existsSync(chained)) throw new Error(`Both ${file} and ${chained} exist. Move one of them, then run this again.`);
    const original = fs.readFileSync(file, 'utf8');
    const clean = removeBlock(original);
    if (clean.trim()) {
      const mode = fs.statSync(file).mode & 0o777;
      fs.renameSync(file, chained);
      if (clean !== original) fs.writeFileSync(chained, clean);
      fs.chmodSync(chained, mode);
      hasChained = true;
    } else {
      fs.unlinkSync(file);
    }
  }
  fs.writeFileSync(file, wrapper(name), { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return { file, chained: hasChained };
}

function unwrapHook(chain) {
  const chained = `${chain.file}${chainedSuffix}`;
  if (!isWrapper(chain.file)) return;
  fs.unlinkSync(chain.file);
  if (fs.existsSync(chained)) fs.renameSync(chained, chain.file);
}

function readState() {
  if (!fs.existsSync(stateFile)) return null;
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

function writeState(state) {
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function restoreGlobalPath(value) {
  if (value) {
    const result = runGit(['config', '--global', 'core.hooksPath', value]);
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Could not restore the global hooks path.');
  } else {
    runGit(['config', '--global', '--unset-all', 'core.hooksPath']);
  }
}

// Undo the hook placement only (the hook files in ~/.youcloned stay for the caller to handle).
function undoPlacement(state) {
  if (state.mode === 'direct' && globalHooksPath() === targetDirectory) restoreGlobalPath(state.originalHooksPath);
  if (state.mode !== 'chain') return;
  for (const chain of state.chains ?? []) {
    if (!fs.existsSync(chain.file)) continue;
    if (state.version === stateVersion) { unwrapHook(chain); continue; }
    // An install from before version 2 appended a block to the end of the existing hook.
    const current = fs.readFileSync(chain.file, 'utf8');
    const original = chain.original == null ? null : Buffer.from(chain.original, 'base64').toString('utf8');
    const block = `${markerStart}\n"$HOME/.youcloned/git-hooks/${path.basename(chain.file)}"\n${markerEnd}\n`;
    if (original !== null && current === `${original}${original.endsWith('\n') ? '' : '\n'}${block}`) fs.writeFileSync(chain.file, original);
    else {
      const cleaned = removeBlock(current);
      if (original === null && !cleaned) fs.unlinkSync(chain.file);
      else fs.writeFileSync(chain.file, cleaned);
    }
  }
}

function install() {
  let state = readState();
  if (state && state.version !== stateVersion) {
    undoPlacement(state);
    state = null;
  }
  copyHooks();
  if (state) {
    if (state.mode === 'chain') {
      const chains = hookNames.map((name) => wrapHook(state.originalHooksPath, name));
      writeState({ ...state, chains });
    }
    return;
  }
  const existing = globalHooksPath();
  if (!existing || samePath(existing, targetDirectory)) {
    const result = runGit(['config', '--global', 'core.hooksPath', targetDirectory]);
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Could not set the global hooks path.');
    writeState({ version: stateVersion, mode: 'direct', originalHooksPath: null });
    return;
  }
  if (!path.isAbsolute(existing)) throw new Error(`Git's global hooks folder is set to a relative path (${existing}), so the key check can't be added safely. Set core.hooksPath to a full path, then run this again.`);
  const chains = hookNames.map((name) => wrapHook(existing, name));
  writeState({ version: stateVersion, mode: 'chain', originalHooksPath: existing, chains });
}

function uninstall() {
  const state = readState();
  if (!state) return;
  undoPlacement(state);
  for (const name of hookNames) {
    const file = path.join(targetDirectory, name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  if (fs.existsSync(installedLibrary)) fs.unlinkSync(installedLibrary);
  if (fs.existsSync(installedNodePath)) fs.unlinkSync(installedNodePath);
  fs.unlinkSync(stateFile);
}

// A test key built at run time, so this file never holds a key-shaped value itself.
function plantedKey() {
  return ['xoxb', 'youcloned', 'verify', 'Q'.repeat(16)].join('-');
}

function refusedByUs(result) {
  return result.status !== 0 && /secret-shaped value/.test(`${result.stderr}`);
}

function verify(repository) {
  const lines = [];
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'youcloned-verify-'));
  const planted = 'youcloned-verify-planted.txt';
  try {
    let where;
    let target;
    if (repository) {
      const top = runGit(['-C', repository, 'rev-parse', '--show-toplevel']);
      if (top.status !== 0) { process.stdout.write(`PROTECTION NOT PROVEN: ${repository} is not a Git repository.\n`); return 1; }
      target = top.stdout.trim();
      where = `the repository at ${target}`;
    } else {
      target = path.join(scratch, 'repo');
      fs.mkdirSync(target);
      const init = runGit(['init', '-q', target]);
      if (init.status !== 0) { process.stdout.write('PROTECTION NOT PROVEN: Git could not make a test repository.\n'); return 1; }
      where = 'a throwaway test repository';
    }

    const local = runGit(['-C', target, 'config', '--local', '--get-all', 'core.hooksPath']);
    if (local.status === 0 && local.stdout.trim()) {
      lines.push(`This repository sets its own hooks folder (core.hooksPath = ${local.stdout.trim()}), which replaces the computer-wide one here.`);
    }

    let result;
    if (repository) {
      // A separate index holds the planted file, so nothing is committed and the owner's staging area is untouched.
      const index = path.join(scratch, 'index');
      const environment = { ...process.env, GIT_INDEX_FILE: index };
      const head = runGit(['-C', target, 'rev-parse', '--verify', '-q', 'HEAD']);
      if (head.status === 0) runGit(['-C', target, 'read-tree', 'HEAD'], { env: environment });
      const blob = runGit(['-C', target, 'hash-object', '-w', '--stdin'], { input: `${plantedKey()}\n` });
      if (blob.status !== 0) { process.stdout.write('PROTECTION NOT PROVEN: Git could not stage the test file.\n'); return 1; }
      const staged = runGit(['-C', target, 'update-index', '--add', '--cacheinfo', `100644,${blob.stdout.trim()},${planted}`], { env: environment });
      if (staged.status !== 0) { process.stdout.write('PROTECTION NOT PROVEN: Git could not stage the test file.\n'); return 1; }
      result = runGit(['-C', target, 'hook', 'run', 'pre-commit'], { env: environment });
      if (result.status === 129) {
        // Older Git without "git hook run": run the hook Git would pick (rev-parse honours core.hooksPath).
        const hookPath = runGit(['-C', target, 'rev-parse', '--git-path', 'hooks/pre-commit']);
        const file = path.resolve(target, hookPath.stdout.trim());
        result = fs.existsSync(file) ? spawnSync('sh', [file], { cwd: target, env: environment, encoding: 'utf8' }) : { status: 0, stderr: '' };
      }
    } else {
      fs.writeFileSync(path.join(target, planted), `${plantedKey()}\n`);
      runGit(['-C', target, 'add', planted]);
      result = runGit(['-C', target, '-c', 'user.name=YouCloned check', '-c', 'user.email=check@example.com', 'commit', '-q', '-m', 'YouCloned protection check']);
    }

    const proven = refusedByUs(result);
    if (proven) lines.unshift(`PROTECTION PROVEN: a planted test key was refused by the YouCloned key check in ${where}.`);
    else lines.unshift(`PROTECTION NOT PROVEN: a planted test key was NOT refused by the YouCloned key check in ${where}. Run node install-git-hooks.mjs --install, then check again.`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return proven ? 0 : 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  const args = process.argv.slice(2);
  if (args[0] === '--verify' && args.length <= 2) process.exitCode = verify(args[1]);
  else if (args.length === 1 && args[0] === '--install') install();
  else if (args.length === 1 && args[0] === '--uninstall') uninstall();
  else throw new Error('Usage: node install-git-hooks.mjs --install|--uninstall|--verify [repository]');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
