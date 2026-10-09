#!/usr/bin/env node
import { scan } from './lib/secret-rules.mjs';

function readStdin() {
  let text = '';
  process.stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    process.stdin.on('data', (chunk) => { text += chunk; });
    process.stdin.on('end', () => resolve(text));
  });
}

function has(pattern, text) {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function blockedReason(command) {
  const finding = scan(command)[0];
  if (finding) return `${finding.rule} detected in a command`;
  if (has(/\b(?:cat|less|more|head|tail|grep)\b[^\n|;&]*?(?:^|[\\/\s])\.env(?:\.[A-Za-z0-9_-]+)?\b/i, command)
    || has(/\bprintenv\b/i, command)
    || has(/\b(?:echo|printf)\b[^\n;]*\$(?:\{)?[A-Za-z_][A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Za-z0-9_]*\}?/i, command)) {
    return 'printing env-file or secret environment values is not allowed';
  }
  if (has(/\b(?:curl|wget)\b[^\n|]*\|\s*(?:sh|bash|zsh|dash|powershell|pwsh)\b/i, command)) return 'piping a download into a shell is not allowed';
  if (has(/\brm\b(?=[^\n;]*(?:-\S*[rR]\S*[fF]|-\S*[fF]\S*[rR]|--recursive)[^\n;]*)(?=[^\n;]*(?:^|\s)(?:\/?$|~(?:[\\/]|$)|\$HOME(?:[\\/]|$)|\$\{HOME\}(?:[\\/]|$)|%USERPROFILE%(?:[\\/]|$)|\$env:USERPROFILE(?:[\\/]|$)))/im, command)) {
    return 'recursive forced deletion of a home folder or root is not allowed';
  }
  if (has(/\bgit\s+push\b(?=[^\n;]*(?:--force(?:-with-lease)?\b|-f\b))(?=[^\n;]*\b(?:main|master)\b)/i, command)) return 'force-pushing main or master is not allowed';
  if (has(/\bgit\s+add\b[^\n;]*?(?:^|[\\/\s])\.env(?:\.[A-Za-z0-9_-]+)?\b/i, command)) return 'adding an env file to git is not allowed';
  if (has(/(?:^|[\\/])\.claude[\\/](?:\.credentials\.json|credentials\.json)|(?:^|[\\/])\.ssh[\\/](?:id_[^\\/\s]+|[^\\/\s]+\.pem)\b|(?:Library[\\/]Application Support[\\/](?:Google[\\/]Chrome|Microsoft[\\/]Edge|Chromium|Safari)|\.config[\\/](?:google-chrome|chromium|microsoft-edge)|AppData[\\/]Local[\\/](?:Google[\\/]Chrome[\\/]User Data|Microsoft[\\/]Edge[\\/]User Data)|(?:Firefox|firefox)[\\/]Profiles?)/i, command)) {
    return 'reading a credential store or browser profile is not allowed';
  }
  return null;
}

let payload = null;
try { payload = JSON.parse(await readStdin()); } catch { /* malformed hook input is allowed */ }
if (payload?.tool_name === 'Bash') {
  const reason = blockedReason(String(payload.tool_input?.command ?? ''));
  if (reason) {
    process.stderr.write(`Blocked: ${reason}.\n`);
    process.exitCode = 2;
  }
}
