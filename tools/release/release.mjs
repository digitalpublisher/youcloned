#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const shipGate = path.resolve(scriptDirectory, '../ship-gate/ship-gate.mjs');

function usage() {
  return 'Usage: node tools/release/release.mjs --version X.Y.Z --out <dir> [--guards-dir <dir>] [--dry-run]';
}

function parseArgs(args) {
  const options = { version: null, out: null, guardsDir: null, dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--version') options.version = args[++index];
    else if (arg === '--out') options.out = args[++index];
    else if (arg === '--guards-dir') options.guardsDir = args[++index];
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!options.version || !options.out) throw new Error(usage());
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(options.version)) {
    throw new Error('--version must be a version such as X.Y.Z');
  }
  if (options.guardsDir && !fs.statSync(options.guardsDir).isDirectory()) throw new Error('--guards-dir must name a directory');
  return options;
}

function excluded(relative, name) {
  const parts = relative.split(path.sep);
  return name === '.git' || name === 'node_modules' || name === 'feed' || name === 'tools'
    || relative === 'tests' || relative.startsWith(`tests${path.sep}`)
    || relative === path.join('.claude-plugin', 'types') || relative.startsWith(path.join('.claude-plugin', 'types') + path.sep)
    || name === '.env' || /\.(?:pem|key)$/i.test(name) || parts.includes('.git');
}

function copyTree(source, destination, relative = '') {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const nextRelative = path.join(relative, entry.name);
    if (excluded(nextRelative, entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyTree(from, to, nextRelative);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

function stageSource(sourceRoot, options) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'youcloned-release-'));
  const plugin = path.join(sourceRoot, 'youcloned');
  if (!fs.statSync(plugin).isDirectory()) throw new Error(`Missing plugin directory: ${plugin}`);
  copyTree(plugin, path.join(stage, 'youcloned'));
  if (options.guardsDir) copyTree(path.resolve(options.guardsDir), path.join(stage, 'guards'));
  return stage;
}

function listFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(file);
    }
  };
  visit(root);
  return files;
}

function makeManifest(stage, version) {
  const files = listFiles(stage).map((file) => {
    const content = fs.readFileSync(file);
    return {
      path: path.relative(stage, file).split(path.sep).join('/'),
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      bytes: content.length,
    };
  });
  const manifest = { version, buildTime: new Date().toISOString(), files };
  fs.writeFileSync(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function runGate(stage) {
  return spawnSync(process.execPath, [shipGate, stage], { encoding: 'utf8' });
}

function main(args = process.argv.slice(2), sourceRoot = process.cwd()) {
  let stage;
  try {
    const options = parseArgs(args);
    stage = stageSource(path.resolve(sourceRoot), options);
    const stagedFiles = listFiles(stage)
      .map((file) => path.relative(stage, file).split(path.sep).join('/'));
    const gate = runGate(stage);
    process.stdout.write(gate.stdout);
    if (options.dryRun) for (const file of stagedFiles) process.stdout.write(`${file}\n`);
    if (gate.error) throw gate.error;
    if (gate.status !== 0) {
      process.stdout.write(`Ship gate: failed (${gate.status})\n`);
      return 1;
    }
    makeManifest(stage, options.version);
    if (options.dryRun) {
      process.stdout.write('Ship gate: passed\n');
      return 0;
    }
    const output = path.resolve(options.out);
    fs.mkdirSync(output, { recursive: true });
    const archiveName = `youcloned-${options.version}.zip`;
    const archive = path.join(output, archiveName);
    const zip = spawnSync('zip', ['-r', '-X', archive, '.'], { cwd: stage, encoding: 'utf8' });
    if (zip.error) throw zip.error;
    if (zip.status !== 0) throw new Error(zip.stderr || 'zip failed');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    fs.writeFileSync(`${archive}.sha256`, `${hash}  ${archiveName}\n`);
    process.stdout.write(`Built ${archive}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    return 2;
  } finally {
    if (stage) fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url))) process.exitCode = main();

export { main };
