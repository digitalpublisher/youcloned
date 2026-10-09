#!/usr/bin/env node
import fs from 'node:fs';

export const KEY_SHAPE_RULES = Object.freeze([
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g],
  ['openai-key', /\bsk-(?!ant-)[A-Za-z0-9_-]{16,}\b/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g],
  ['slack-token', /\bxox(?:b|p|a|s|app)-[A-Za-z0-9-]{10,}\b/g],
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{20,}\b/g],
  ['stripe-secret-key', /\b(?:sk_live_|rk_live_)[A-Za-z0-9]{16,}\b/g],
  ['stripe-webhook-secret', /\bwhsec_[A-Za-z0-9]{16,}\b/g],
  ['sendgrid-key', /\bSG\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\b/g],
  ['pem-private-key', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g],
]);

export const DATABASE_URL_RULE = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/([^\s/@:]+):([^\s/@]+)@[^\s/]+/gi;
const GENERIC_ASSIGNMENT = /^\s*(?:(?:export\s+)?(?:const|let|var)\s+)?"?([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)"?\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s,\]]+))/gm;

export function isPlaceholder(value) {
  const trimmed = String(value).trim().replace(/^(?:['"`])|(?:['"`])$/g, '');
  return !trimmed
    || /^x+$/i.test(trimmed)
    || /^your[-_ ]?(?:key|secret|token|password)(?:[-_ ]?here)?$/i.test(trimmed)
    || /^<[^>]+>$/.test(trimmed)
    || /^\$\{[^}]+\}$/.test(trimmed)
    || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)
    || /^process\.env(?:\.|\[)/i.test(trimmed);
}

export function mask(value) {
  void value;
  return '[masked]';
}

function location(text, index) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const column = index - before.lastIndexOf('\n');
  return { line, column };
}

function addFinding(findings, text, index, rule, matched, masked = mask(matched)) {
  findings.push({ rule, index, ...location(text, index), masked });
}

export function scan(text) {
  const source = String(text ?? '');
  const findings = [];

  for (const [rule, expression] of KEY_SHAPE_RULES) {
    expression.lastIndex = 0;
    for (const match of source.matchAll(expression)) {
      addFinding(findings, source, match.index, rule, match[0], rule === 'pem-private-key' ? '[private-key-marker]' : undefined);
    }
  }

  DATABASE_URL_RULE.lastIndex = 0;
  for (const match of source.matchAll(DATABASE_URL_RULE)) {
    if (!isPlaceholder(match[2])) addFinding(findings, source, match.index, 'database-url-password', match[0]);
  }

  GENERIC_ASSIGNMENT.lastIndex = 0;
  for (const match of source.matchAll(GENERIC_ASSIGNMENT)) {
    const value = match.slice(2).find((part) => part !== undefined) ?? '';
    if (value.length >= 16 && !isPlaceholder(value)) {
      addFinding(findings, source, match.index, 'generic-secret-assignment', match[0], `${match[1]}=****`);
    }
  }

  return findings.sort((a, b) => a.index - b.index);
}

export function formatFindings(findings, label = 'input') {
  return findings.map((finding) => `${label}:${finding.line} ${finding.rule} ${finding.masked}`).join('\n');
}

function main(args) {
  if (!args.includes('--stdin')) {
    process.stderr.write('Usage: node secret-rules.mjs --stdin [--label name]\n');
    return 2;
  }
  const labelIndex = args.indexOf('--label');
  const label = labelIndex >= 0 ? args[labelIndex + 1] ?? 'input' : 'input';
  const findings = scan(fs.readFileSync(0, 'utf8'));
  if (findings.length) process.stdout.write(`${formatFindings(findings, label)}\n`);
  return findings.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
