import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const here = path.dirname(new URL(import.meta.url).pathname);
const release = path.join(here, 'release.mjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-fixture-'));
  fs.mkdirSync(path.join(root, 'youcloned', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'youcloned', 'plugin.json'), '{"name":"fixture"}\n');
  fs.writeFileSync(path.join(root, 'youcloned', 'nested', 'note.txt'), 'ordinary fixture text\n');
  return root;
}

function run(root, out, extra = []) {
  return spawnSync(process.execPath, [release, '--version', '1.2.3', '--out', out, ...extra], {
    cwd: root,
    encoding: 'utf8',
  });
}

function entries(archive) {
  return execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
}

test('a clean fixture builds a zip whose manifest hashes match', () => {
  const root = fixture();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'release-output-'));
  const result = run(root, out);
  assert.equal(result.status, 0, result.stderr);
  const archive = path.join(out, 'youcloned-1.2.3.zip');
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'release-unzip-'));
  execFileSync('unzip', ['-q', archive, '-d', extracted]);
  const manifest = JSON.parse(fs.readFileSync(path.join(extracted, 'manifest.json'), 'utf8'));
  for (const file of manifest.files) {
    const body = fs.readFileSync(path.join(extracted, file.path));
    assert.equal(file.bytes, body.length);
    assert.equal(file.sha256, crypto.createHash('sha256').update(body).digest('hex'));
  }
});

test('a planted fake key fails the gate and writes no zip', () => {
  const root = fixture();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'release-output-'));
  fs.writeFileSync(path.join(root, 'youcloned', 'bad.txt'), 'sk-' + 'Q'.repeat(24));
  const result = run(root, out);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /openai-key/);
  assert.equal(fs.existsSync(path.join(out, 'youcloned-1.2.3.zip')), false);
});

test('feed, tools, and .env files are absent from the zip', () => {
  const root = fixture();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'release-output-'));
  fs.mkdirSync(path.join(root, 'youcloned', 'feed'), { recursive: true });
  fs.mkdirSync(path.join(root, 'youcloned', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'youcloned', 'feed', 'hidden.txt'), 'hidden');
  fs.writeFileSync(path.join(root, 'youcloned', 'tools', 'hidden.txt'), 'hidden');
  fs.writeFileSync(path.join(root, 'youcloned', '.env'), 'hidden');
  assert.equal(run(root, out).status, 0);
  const names = entries(path.join(out, 'youcloned-1.2.3.zip'));
  assert.ok(!names.some((name) => name.includes('/feed/') || name.includes('/tools/') || name.endsWith('/.env')));
});

test('dry-run writes no zip', () => {
  const root = fixture();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'release-output-'));
  const result = run(root, out, ['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(out, 'youcloned-1.2.3.zip')), false);
});

test('manifest list is sorted and stable between runs on the same input', () => {
  const root = fixture();
  const one = fs.mkdtempSync(path.join(os.tmpdir(), 'release-output-'));
  const two = fs.mkdtempSync(path.join(os.tmpdir(), 'release-output-'));
  assert.equal(run(root, one).status, 0);
  assert.equal(run(root, two).status, 0);
  const readManifest = (out) => {
    const extract = fs.mkdtempSync(path.join(os.tmpdir(), 'release-unzip-'));
    execFileSync('unzip', ['-q', path.join(out, 'youcloned-1.2.3.zip'), '-d', extract]);
    return JSON.parse(fs.readFileSync(path.join(extract, 'manifest.json'), 'utf8')).files;
  };
  const first = readManifest(one);
  const second = readManifest(two);
  assert.deepEqual(first, [...first].sort((a, b) => a.path.localeCompare(b.path)));
  assert.deepEqual(first, second);
});

test('release still runs when started through a symlink to a folder with a space', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'release-spaced-'));
  const linked = path.join(parent, 'My Folder');
  fs.mkdirSync(path.join(parent, 'Real Copy', 'tools'), { recursive: true });
  fs.cpSync(path.resolve(here, '..'), path.join(parent, 'Real Copy', 'tools'), { recursive: true });
  fs.symlinkSync(path.join(parent, 'Real Copy'), linked);
  const root = fixture();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'release-output-'));
  fs.writeFileSync(path.join(root, 'youcloned', 'bad.txt'), 'sk-' + 'Q'.repeat(24));
  const result = spawnSync(process.execPath, [path.join(linked, 'tools', 'release', 'release.mjs'), '--version', '1.2.3', '--out', out], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /openai-key/);
});
