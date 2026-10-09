#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hookNames = ['pre-commit', 'pre-push'];
const markerStart = '# youcloned hooks begin';
const markerEnd = '# youcloned hooks end';
const guardDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
const targetDirectory = path.join(home, '.youcloned', 'git-hooks');
const installedLibrary = path.join(home, '.youcloned', 'lib', 'secret-rules.mjs');
const installedNodePath = path.join(home, '.youcloned', 'lib', 'node-path');
const stateFile = path.join(targetDirectory, '.youcloned-install-state.json');

function runGit(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

function globalHooksPath() {
  const result = runGit(['config', '--global', '--get', 'core.hooksPath']);
  return result.status === 0 ? result.stdout.trim() : null;
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

function chainBlock(name) {
  return `${markerStart}\n"$HOME/.youcloned/git-hooks/${name}"\n${markerEnd}\n`;
}

function removeBlock(text) {
  const pattern = new RegExp(`(?:\\r?\\n)?${markerStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${markerEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\r?\\n)?`, 'g');
  return text.replace(pattern, '');
}

function addChain(directory, name) {
  const file = path.join(directory, name);
  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const clean = original === null ? '' : removeBlock(original);
  const separator = clean && !clean.endsWith('\n') ? '\n' : '';
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(file, `${clean}${separator}${chainBlock(name)}`, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return { file, original: original === null ? null : Buffer.from(original).toString('base64') };
}

function writeState(state) {
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function install() {
  const existing = globalHooksPath();
  if (fs.existsSync(stateFile)) return;
  copyHooks();
  if (!existing) {
    const result = runGit(['config', '--global', 'core.hooksPath', targetDirectory]);
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Could not set the global hooks path.');
    writeState({ mode: 'direct', originalHooksPath: null });
    return;
  }
  const chains = hookNames.map((name) => addChain(existing, name));
  writeState({ mode: 'chain', originalHooksPath: existing, chains });
}

function restoreGlobalPath(value) {
  if (value) {
    const result = runGit(['config', '--global', 'core.hooksPath', value]);
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Could not restore the global hooks path.');
  } else {
    runGit(['config', '--global', '--unset-all', 'core.hooksPath']);
  }
}

function uninstall() {
  if (!fs.existsSync(stateFile)) return;
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (state.mode === 'direct' && globalHooksPath() === targetDirectory) restoreGlobalPath(state.originalHooksPath);
  if (state.mode === 'chain') {
    for (const chain of state.chains ?? []) {
      if (!fs.existsSync(chain.file)) continue;
      const current = fs.readFileSync(chain.file, 'utf8');
      const original = chain.original === null ? null : Buffer.from(chain.original, 'base64').toString('utf8');
      if (original !== null && current === `${original}${original.endsWith('\n') ? '' : '\n'}${chainBlock(path.basename(chain.file))}`) fs.writeFileSync(chain.file, original);
      else {
        const cleaned = removeBlock(current);
        if (original === null && !cleaned) fs.unlinkSync(chain.file);
        else fs.writeFileSync(chain.file, cleaned);
      }
    }
  }
  for (const name of hookNames) {
    const file = path.join(targetDirectory, name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  if (fs.existsSync(installedLibrary)) fs.unlinkSync(installedLibrary);
  if (fs.existsSync(installedNodePath)) fs.unlinkSync(installedNodePath);
  fs.unlinkSync(stateFile);
}

try {
  if (process.argv.slice(2).length !== 1 || !['--install', '--uninstall'].includes(process.argv[2])) throw new Error('Usage: node install-git-hooks.mjs --install|--uninstall');
  if (process.argv[2] === '--install') install(); else uninstall();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
