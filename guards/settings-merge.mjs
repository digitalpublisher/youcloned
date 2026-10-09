#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const marker = '# youcloned';

function usage() {
  return 'Usage: node settings-merge.mjs --install|--uninstall [--settings <path>] [--guards-dir <dir>]';
}

function parseArgs(args) {
  const options = { action: null, settings: null, guardsDir: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--install' || arg === '--uninstall') {
      if (options.action) throw new Error(usage());
      options.action = arg;
    } else if (arg === '--settings' || arg === '--guards-dir') {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} needs a path.`);
      options[arg === '--settings' ? 'settings' : 'guardsDir'] = value;
      index += 1;
    } else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!options.action) throw new Error(usage());
  return options;
}

function quote(value) {
  return `"${String(value).replace(/(["\\])/g, '\\$1')}"`;
}

function statePath(settings) {
  return `${settings}.youcloned-merge-state.json`;
}

function commandFor(guardsDir, name) {
  return `node ${quote(path.join(guardsDir, name))} ${marker}`;
}

function ours(hook) {
  return hook?.type === 'command' && typeof hook.command === 'string' && hook.command.trimEnd().endsWith(marker);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function removeOurs(settings) {
  if (!Array.isArray(settings.hooks?.PreToolUse)) return;
  settings.hooks.PreToolUse = settings.hooks.PreToolUse
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const next = clone(entry);
      if (Array.isArray(next.hooks)) next.hooks = next.hooks.filter((hook) => !ours(hook));
      return next;
    })
    .filter((entry) => !entry || typeof entry !== 'object' || !Array.isArray(entry.hooks) || entry.hooks.length);
  if (!settings.hooks.PreToolUse.length) delete settings.hooks.PreToolUse;
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
}

function addHook(settings, matcher, command) {
  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];
  if (!settings.hooks.PreToolUse.some((entry) => Array.isArray(entry?.hooks) && entry.hooks.some((hook) => hook?.command === command))) {
    settings.hooks.PreToolUse.push({ matcher, hooks: [{ type: 'command', command }] });
  }
}

function readSettings(file) {
  if (!fs.existsSync(file)) return { exists: false, bytes: Buffer.alloc(0), settings: {} };
  const bytes = fs.readFileSync(file);
  let settings;
  try { settings = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Existing settings file is not valid JSON; no changes were made.'); }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Existing settings file must contain a JSON object; no changes were made.');
  return { exists: true, bytes, settings };
}

function backupName(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${file}.${stamp}.bak`;
}

function writeState(file, state) {
  fs.writeFileSync(statePath(file), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function install(settingsFile, guardsDir) {
  const current = readSettings(settingsFile);
  const commands = [
    ['Write|Edit|MultiEdit', commandFor(guardsDir, 'secret-write-guard.mjs')],
    ['Bash', commandFor(guardsDir, 'command-guard.mjs')],
    ['Write|Edit', commandFor(guardsDir, 'banned-words-guard.mjs')],
  ];
  const alreadyInstalled = commands.every(([, command]) => current.settings.hooks?.PreToolUse?.some((entry) => entry?.hooks?.some((hook) => hook?.command === command)));
  if (alreadyInstalled) return;
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const backup = current.exists ? backupName(settingsFile) : null;
  if (backup) fs.writeFileSync(backup, current.bytes);
  for (const [matcher, command] of commands) addHook(current.settings, matcher, command);
  const rendered = `${JSON.stringify(current.settings, null, 2)}\n`;
  fs.writeFileSync(settingsFile, rendered);
  writeState(settingsFile, {
    existed: current.exists,
    original: current.bytes.toString('base64'),
    installed: Buffer.from(rendered).toString('base64'),
    backup,
  });
}

function uninstall(settingsFile) {
  const current = readSettings(settingsFile);
  const stateName = statePath(settingsFile);
  const state = fs.existsSync(stateName) ? JSON.parse(fs.readFileSync(stateName, 'utf8')) : null;
  if (state && current.bytes.toString('base64') === state.installed) {
    if (state.existed) fs.writeFileSync(settingsFile, Buffer.from(state.original, 'base64'));
    else if (fs.existsSync(settingsFile)) fs.unlinkSync(settingsFile);
  } else if (current.exists) {
    removeOurs(current.settings);
    fs.writeFileSync(settingsFile, `${JSON.stringify(current.settings, null, 2)}\n`);
  }
  if (state && fs.existsSync(stateName)) fs.unlinkSync(stateName);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const settingsFile = path.resolve(options.settings ?? path.join(home, '.claude', 'settings.json'));
  const guardsDir = path.resolve(options.guardsDir ?? path.dirname(fileURLToPath(import.meta.url)));
  if (options.action === '--install') install(settingsFile, guardsDir); else uninstall(settingsFile);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
