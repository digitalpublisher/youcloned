#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { scan } from './lib/secret-rules.mjs';

async function readInput() {
  try {
    return JSON.parse(await awaitStdin());
  } catch {
    return null;
  }
}

function awaitStdin() {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { text += chunk; });
  return new Promise((resolve) => process.stdin.on('end', () => resolve(text)));
}

function writtenText(input) {
  if (!input || typeof input !== 'object') return '';
  const tool = input.tool_input ?? {};
  if (input.tool_name === 'Write') return typeof tool.content === 'string' ? tool.content : '';
  if (input.tool_name === 'Edit') return typeof tool.new_string === 'string' ? tool.new_string : '';
  if (input.tool_name === 'MultiEdit') {
    return Array.isArray(tool.edits)
      ? tool.edits.map((edit) => typeof edit?.new_string === 'string' ? edit.new_string : '').join('\n')
      : '';
  }
  return '';
}

function isIgnoredEnvFile(file) {
  if (typeof file !== 'string' || !/(?:^|[\\/])?\.env(?:\.[^\\/]+)?$/i.test(file)) return false;
  const result = spawnSync('git', ['check-ignore', '-q', '--', file], { stdio: 'ignore' });
  return result.status === 0;
}

const payload = await readInput();
if (payload && ['Write', 'Edit', 'MultiEdit'].includes(payload.tool_name)) {
  const file = payload.tool_input?.file_path;
  if (!isIgnoredEnvFile(file)) {
    const finding = scan(writtenText(payload))[0];
    if (finding) {
      process.stderr.write(`Blocked: ${finding.rule} detected. Put the key in a git-ignored env file or the host's secret store.\n`);
      process.exitCode = 2;
    }
  }
}
