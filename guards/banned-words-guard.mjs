#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function homeDirectory() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function readStdin() {
  let text = '';
  process.stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    process.stdin.on('data', (chunk) => { text += chunk; });
    process.stdin.on('end', () => resolve(text));
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function contentFor(payload) {
  const input = payload?.tool_input ?? {};
  if (payload?.tool_name === 'Write') return input.content ?? '';
  if (payload?.tool_name === 'Edit') return input.new_string ?? '';
  return '';
}

function loadBans() {
  const file = path.join(homeDirectory(), '.youcloned', 'bans.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return {
      words: Array.isArray(parsed.words) ? parsed.words.filter((item) => typeof item === 'string' && item) : [],
      phrases: Array.isArray(parsed.phrases) ? parsed.phrases.filter((item) => typeof item === 'string' && item) : [],
      message: typeof parsed.message === 'string' && parsed.message ? parsed.message : 'Rewrite the blocked wording.',
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return null;
  }
}

function matches(text, bans) {
  return [...new Set([...bans.words, ...bans.phrases].filter((item) => new RegExp(`\\b${escapeRegExp(item)}\\b`, 'i').test(text)))];
}

let payload = null;
try { payload = JSON.parse(await readStdin()); } catch { /* malformed hook input is allowed */ }
if (payload && ['Write', 'Edit'].includes(payload.tool_name)) {
  const bans = loadBans();
  if (bans) {
    const found = matches(String(contentFor(payload)), bans);
    if (found.length) {
      process.stderr.write(`Blocked: ${bans.message} Matches: ${found.join(', ')}.\n`);
      process.exitCode = 2;
    }
  }
}
