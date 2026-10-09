#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATABASE_URL_RULE, KEY_SHAPE_RULES, isPlaceholder, mask } from '../../guards/lib/secret-rules.mjs';

const BINARY_EXTENSIONS = new Set([
  '.7z', '.bmp', '.class', '.dll', '.doc', '.docx', '.eot', '.exe', '.gif',
  '.gz', '.ico', '.jar', '.jpeg', '.jpg', '.mp3', '.mp4', '.otf', '.pdf',
  '.png', '.tar', '.ttf', '.wasm', '.webm', '.woff', '.woff2', '.zip',
]);

const SCRIPT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const REPO_DENYLIST = path.join(SCRIPT_DIR, 'denylist.txt');
const EMAIL_ALLOWLIST = path.join(SCRIPT_DIR, 'allow-emails.txt');

function usage() {
  return 'Usage: node tools/ship-gate/ship-gate.mjs <dir> [--denylist <file>] [--json]';
}

function parseArgs(args) {
  const options = { dir: null, denylist: null, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--denylist') {
      options.denylist = args[index + 1];
      index += 1;
    } else if (!options.dir) options.dir = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!options.dir) throw new Error(usage());
  if (args.includes('--denylist') && !options.denylist) throw new Error('--denylist needs a file path');
  return options;
}

function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function loadLiterals(file, source) {
  const lines = readLines(file);
  if (lines === null) return [];
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((literal) => ({ literal: literal.toLowerCase(), source }));
}

function loadEmailAllowlist() {
  return new Set((readLines(EMAIL_ALLOWLIST) ?? [])
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith('#')));
}

function isBinary(file) {
  if (BINARY_EXTENSIONS.has(path.extname(file).toLowerCase())) return true;
  try {
    const handle = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(8192);
    const count = fs.readSync(handle, buffer, 0, buffer.length, 0);
    fs.closeSync(handle);
    return buffer.subarray(0, count).includes(0);
  } catch {
    return true;
  }
}

function filesUnder(root) {
  const files = [];
  const excludedGate = path.resolve(root, 'tools/ship-gate');
  const visit = (directory) => {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.name === '.git' || entry.name === 'node_modules' || path.resolve(file) === excludedGate) {
        continue;
      }
      if (entry.isDirectory()) {
        visit(file);
      } else if (entry.isFile() && !isBinary(file)) {
        files.push(file);
      }
    }
  };
  visit(root);
  return files;
}

const PATH_RULES = [
  /\/Users\/([^/\s]+)\//g,
  /[A-Za-z]:\\Users\\([^\\\s]+)\\/g,
];
const EMAIL = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const GENERIC_ASSIGNMENT = /\b(?:KEY|SECRET|TOKEN|PASSWORD|[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD))\s*[:=]\s*([^\s]+)/gi;

function findInFile(file, root, literals, emailAllowlist) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const findings = [];
  const relative = path.relative(root, file) || path.basename(file);
  const add = (index, rule, matched, privateMatch = false) => {
    const line = content.slice(0, index).split('\n').length;
    findings.push({ file: relative, line, rule, masked: privateMatch ? '[private]' : mask(matched) });
  };

  for (const [rule, expression] of KEY_SHAPE_RULES) {
    expression.lastIndex = 0;
    for (const match of content.matchAll(expression)) add(match.index, rule, match[0]);
  }
  DATABASE_URL_RULE.lastIndex = 0;
  for (const match of content.matchAll(DATABASE_URL_RULE)) add(match.index, 'database-url-password', match[0]);
  for (const expression of PATH_RULES) {
    expression.lastIndex = 0;
    for (const match of content.matchAll(expression)) {
      if (match[1].toLowerCase() !== 'you' && match[1] !== '<name>') add(match.index, 'author-machine-path', match[0]);
    }
  }
  GENERIC_ASSIGNMENT.lastIndex = 0;
  for (const match of content.matchAll(GENERIC_ASSIGNMENT)) {
    if (match[1].length >= 16 && !isPlaceholder(match[1])) add(match.index, 'generic-secret-assignment', match[0]);
  }
  EMAIL.lastIndex = 0;
  for (const match of content.matchAll(EMAIL)) {
    const address = match[0].toLowerCase();
    const domain = match[1].toLowerCase();
    if (!['example.com', 'example.org'].includes(domain) && !emailAllowlist.has(address)) add(match.index, 'email-address', match[0]);
  }
  const lower = content.toLowerCase();
  for (const item of literals) {
    let index = lower.indexOf(item.literal);
    while (index !== -1) {
      add(index, item.source, content.slice(index, index + item.literal.length), item.source === 'denylist:private');
      index = lower.indexOf(item.literal, index + item.literal.length);
    }
  }
  return findings;
}

export function scan(root, options = {}) {
  const absoluteRoot = path.resolve(root);
  const privateDenylist = path.join(os.homedir(), '.config/youcloned/ship-denylist.txt');
  const literals = [
    ...loadLiterals(REPO_DENYLIST, 'denylist:repo'),
    ...loadLiterals(privateDenylist, 'denylist:private'),
    ...(options.denylist ? loadLiterals(options.denylist, 'denylist:custom') : []),
  ];
  const allowlist = loadEmailAllowlist();
  return filesUnder(absoluteRoot).flatMap((file) => findInFile(file, absoluteRoot, literals, allowlist));
}

export function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    const findings = scan(options.dir, options);
    if (options.json) process.stdout.write(`${JSON.stringify({ count: findings.length, findings }, null, 2)}\n`);
    else for (const finding of findings) process.stdout.write(`${finding.file}:${finding.line} ${finding.rule} ${finding.masked}\n`);
    return findings.length ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main();
