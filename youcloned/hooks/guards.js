// The key guards, run inside YouCloned itself so they work on a Mac with no Node or developer tools.
// The rules match guards/lib/secret-rules.mjs (a test keeps the two the same). Nothing here ever
// repeats a matched value: a refusal names the kind of key only.

export const KEY_SHAPE_RULES = [
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
]
export const DATABASE_URL_RULE = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/([^\s/@:]+):([^\s/@]+)@[^\s/]+/gi
export const GENERIC_ASSIGNMENT = /^\s*(?:(?:export\s+)?(?:const|let|var)\s+)?"?([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)"?\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s,\]]+))/gm

export function isPlaceholder(value) {
  const t = String(value).trim().replace(/^(?:['"`])|(?:['"`])$/g, '')
  return !t || /^x+$/i.test(t) || /^your[-_ ]?(?:key|secret|token|password)(?:[-_ ]?here)?$/i.test(t)
    || /^<[^>]+>$/.test(t) || /^\$\{[^}]+\}$/.test(t) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(t) || /^process\.env(?:\.|\[)/i.test(t)
}

// The kind of the first key found in the text, or null.
export function firstKey(text) {
  const source = String(text ?? '')
  for (const [rule, expression] of KEY_SHAPE_RULES) {
    expression.lastIndex = 0
    if (expression.test(source)) return rule
  }
  DATABASE_URL_RULE.lastIndex = 0
  for (const m of source.matchAll(DATABASE_URL_RULE)) if (!isPlaceholder(m[2])) return 'database-url-password'
  GENERIC_ASSIGNMENT.lastIndex = 0
  for (const m of source.matchAll(GENERIC_ASSIGNMENT)) {
    const value = m.slice(2).find(part => part !== undefined) ?? ''
    if (value.length >= 16 && !isPlaceholder(value)) return 'generic-secret-assignment'
  }
  return null
}

// What a file tool call would put on disk.
export function writtenText(e) {
  if (e.tool === 'Write') return typeof e.content === 'string' ? e.content : ''
  if (e.tool === 'Edit') return typeof e.new_string === 'string' ? e.new_string : ''
  if (e.tool === 'MultiEdit') return Array.isArray(e.edits) ? e.edits.map(x => typeof x?.new_string === 'string' ? x.new_string : '').join('\n') : ''
  if (e.tool === 'NotebookEdit') return typeof e.new_source === 'string' ? e.new_source : ''
  return ''
}

export const isEnvFile = (file) => typeof file === 'string' && /(?:^|[\\/])\.env(?:\.[^\\/]+)?$/i.test(file)

const has = (pattern, text) => { pattern.lastIndex = 0; return pattern.test(text) }

// Why a shell command is refused, or null to let it run.
export function commandReason(command) {
  const c = String(command ?? '')
  const key = firstKey(c)
  if (key) return key + ' found in a command'
  if (has(/\b(?:cat|less|more|head|tail|grep)\b[^\n|;&]*?(?:^|[\\/\s])\.env(?:\.[A-Za-z0-9_-]+)?\b/i, c)
    || has(/\bprintenv\b/i, c)
    || has(/\b(?:echo|printf)\b[^\n;]*\$(?:\{)?[A-Za-z_][A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Za-z0-9_]*\}?/i, c)) {
    return 'printing an env file or a secret value is not allowed'
  }
  if (has(/\b(?:curl|wget)\b[^\n|]*\|\s*(?:sh|bash|zsh|dash|powershell|pwsh)\b/i, c)) return 'piping a download into a shell is not allowed'
  if (has(/\brm\b(?=[^\n;]*(?:-\S*[rR]\S*[fF]|-\S*[fF]\S*[rR]|--recursive)[^\n;]*)(?=[^\n;]*(?:^|\s)(?:\/?$|~(?:[\\/]|$)|\$HOME(?:[\\/]|$)|\$\{HOME\}(?:[\\/]|$)|%USERPROFILE%(?:[\\/]|$)|\$env:USERPROFILE(?:[\\/]|$)))/im, c)) {
    return 'deleting a home folder or the whole disk is not allowed'
  }
  if (has(/\bgit\s+push\b(?=[^\n;]*(?:--force(?:-with-lease)?\b|-f\b))(?=[^\n;]*\b(?:main|master)\b)/i, c)) return 'force-pushing main or master is not allowed'
  if (has(/\bgit\s+add\b[^\n;]*?(?:^|[\\/\s])\.env(?:\.[A-Za-z0-9_-]+)?\b/i, c)) return 'adding an env file to git is not allowed'
  if (has(/(?:^|[\\/])\.claude[\\/](?:\.credentials\.json|credentials\.json)|(?:^|[\\/])\.ssh[\\/](?:id_[^\\/\s]+|[^\\/\s]+\.pem)\b|(?:Library[\\/]Application Support[\\/](?:Google[\\/]Chrome|Microsoft[\\/]Edge|Chromium|Safari)|\.config[\\/](?:google-chrome|chromium|microsoft-edge)|AppData[\\/]Local[\\/](?:Google[\\/]Chrome[\\/]User Data|Microsoft[\\/]Edge[\\/]User Data)|(?:Firefox|firefox)[\\/]Profiles?)/i, c)) {
    return 'reading a password store or browser profile is not allowed'
  }
  return null
}

// The owner's own banned words from ~/.youcloned/bans.json: { words, phrases, message }.
export function parseBans(text) {
  try {
    const b = JSON.parse(text)
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null
    const list = (v) => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : []
    return { words: list(b.words), phrases: list(b.phrases), message: typeof b.message === 'string' && b.message ? b.message : 'Rewrite the blocked wording.' }
  } catch { return null }
}

export function bannedIn(text, bans) {
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...new Set([...bans.words, ...bans.phrases].filter(item => new RegExp('\\b' + esc(item) + '\\b', 'i').test(String(text))))]
}
