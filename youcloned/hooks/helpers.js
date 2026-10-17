// The two feed-me helpers and their safety gate.
//   librarian    runs on Haiku: puts the owner's history into their library with library/feed.py
//   wiki-writer  runs on Sonnet: reads the library and writes the wiki pages in <clone folder>/Library
// Their instructions live in the add-on's agents folder (agents/<name>.md: frontmatter, then the prompt).
// The gate is code, not a request in the prompt: a helper may run only feed.py (only its own commands,
// with every argument checked and --helper on, so feed.py checks the files again), read and write only
// in its own folders, never touch an env file or a key file, and the librarian may use only Gmail's two
// look-up tools.
//   librarian    folders: SCRATCH (~/.youcloned/feeding) and <clone folder>/Feed me
//   wiki-writer  folder:  <clone folder>/Library

import { inside, normalize } from './gate.js'
import { isEnvFile } from './guards.js'

export const HELPERS = [
  { name: 'librarian', maxTurns: 300, commands: ['add', 'web', 'doc', 'folder', 'transcribe', 'youtube', 'search', 'stats'] },
  { name: 'wiki-writer', maxTurns: 150, commands: ['search', 'stats', 'wiki-put', 'wiki-list'] },
]

const GMAIL_READS = /^mcp__.+__(search_threads|get_thread)$/
const READS = new Set(['Read', 'Grep', 'Glob', 'ToolSearch'])

// agents/<name>.md: "---", key: value lines, "---", then the prompt.
export function parseAgent(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(String(text || ''))
  if (!m) return null
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim())
    if (kv) meta[kv[1]] = kv[2].trim()
  }
  const tools = String(meta.tools || '').split(',').map(t => t.trim()).filter(Boolean)
  const prompt = m[2].trim()
  if (!meta.name || !meta.description || !prompt) return null
  return { name: meta.name, description: meta.description, model: meta.model || undefined, tools, prompt }
}

// The Gmail connector's look-up tools under whatever server name this Claude gives it.
export function gmailReads(names) {
  return [...new Set(names.filter(n => typeof n === 'string' && GMAIL_READS.test(n)))]
}

// Splits a shell command into words, the way a POSIX shell would for the simple commands we allow.
// Returns { words } or { why } when it holds anything that could run something else.
export function shellWords(command) {
  const s = String(command ?? '')
  const words = []
  let cur = null
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote === "'") {
      if (c === "'") quote = ''
      else cur += c
      continue
    }
    if (quote === '"') {
      if (c === '"') { quote = ''; continue }
      if (c === '$' || c === '`') return { why: 'a $ or a backtick inside double quotes can run another command; put that text in single quotes' }
      if (c === '\\' && i + 1 < s.length && '"\\'.includes(s[i + 1])) { cur += s[++i]; continue }
      cur += c
      continue
    }
    if (c === "'" || c === '"') { quote = c; if (cur === null) cur = ''; continue }
    if (c === ' ' || c === '\t') { if (cur !== null) { words.push(cur); cur = null } continue }
    if (/[\n\r;&|<>()`$*?{}\[\]~!#]/.test(c)) return { why: 'only one plain command is allowed, with nothing chained, piped, redirected or expanded' }
    if (c === '\\') {
      if (i + 1 >= s.length) return { why: 'the command ends in a backslash' }
      if (cur === null) cur = ''
      cur += s[++i]
      continue
    }
    if (cur === null) cur = ''
    cur += c
  }
  if (quote) return { why: 'a quote is not closed' }
  if (cur !== null) words.push(cur)
  return { words }
}

const PYTHON = /^(?:.*[\\/])?(?:python3?(?:\.\d+)?|py)(?:\.exe)?$/i

// A file name that looks like it holds a key: private keys, certificates, keystores, login files.
// library/feed.py holds the same list (KEY_NAME); change both together.
const KEY_NAME = /(?:\.(?:pem|key|p12|pfx|keystore|jks|ppk|gpg|asc|kdbx)$|^id_(?:rsa|dsa|ecdsa|ed25519)|^(?:credentials|secrets?)(?:\.|$)|^\.(?:npmrc|netrc|pgpass|pypirc|git-credentials)$|^token\.json$)/i
const segments = (p) => String(p).split('/').filter(Boolean)
export const isKeyFile = (file) => typeof file === 'string' && KEY_NAME.test(segments(String(file).replace(/\\/g, '/')).pop() || '')

// A file a helper reads through Grep without a folder-wide glob: these kinds only, never an env or key file.
const SAFE_EXT = new Set(['txt', 'text', 'md', 'markdown', 'csv', 'html', 'htm', 'docx', 'pptx', 'epub', 'pdf', 'vtt', 'srt'])

// Each helper's own folders. Unknown folders mean nothing is allowed yet.
function folders(name, ctx) {
  const folder = ctx.folder || (ctx.library ? String(ctx.library).replace(/[\\/]Library[\\/]?$/, '') : '')
  const feedMe = folder ? folder + '/Feed me' : ''
  if (name === 'librarian') return { read: [ctx.scratch, feedMe], feed: [ctx.scratch, feedMe], remove: [ctx.scratch], write: [ctx.scratch], env: folder ? folder + '/.env' : '' }
  return { read: [ctx.library], wiki: [ctx.library], write: [ctx.library], env: folder ? folder + '/.env' : '' }
}

// null when p is a full path inside one of dirs and names no env file or key file on the way, else the reason.
export function pathReason(p, dirs, what = 'that path') {
  if (typeof p !== 'string' || !p.trim()) return what + ' is missing'
  const n = normalize(p)
  if (!n) return what + ' must be a full path'
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p)) return what + ' may not use ..'
  if (segments(n).some(s => isEnvFile(s))) return 'helpers never touch an env file'
  if (isKeyFile(n)) return 'helpers never touch a key file'
  const own = dirs.filter(Boolean)
  if (!own.length) return 'the helper\'s folder is not known yet'
  return own.some(d => inside(n, d)) ? null : what + ' (' + p + ') is outside ' + own.join(' and ')
}

// A Grep glob or a Glob pattern: relative (or a full path inside dirs), no .., no dot files, no env names.
function patternReason(pattern, dirs, needsExt) {
  const g = String(pattern ?? '')
  if (!g.trim()) return needsExt ? 'Grep needs a glob such as **/*.md when it searches a folder' : 'the pattern is missing'
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(g)) return 'a pattern may not use ..'
  if (/env/i.test(g)) return 'helpers never search for env files'
  const parts = segments(g.replace(/\\/g, '/'))
  if (parts.some(s => s.startsWith('.'))) return 'a pattern may not reach dot files'
  if (/^(?:[A-Za-z]:)?[\\/]/.test(g)) {
    const why = pathReason(g.replace(/[*?\[{].*$/, '') || '/', dirs, 'the pattern')
    if (why) return why
  }
  if (needsExt) {
    const last = parts[parts.length - 1] || ''
    const m = /\.\{([A-Za-z0-9,]+)\}$/.exec(last) || /\.([A-Za-z0-9]+)$/.exec(last)
    const exts = m ? m[1].toLowerCase().split(',') : []
    if (!exts.length || !exts.every(e => SAFE_EXT.has(e))) return 'Grep searches a folder only with a glob ending in a document type, such as **/*.md'
  }
  return null
}

function readReason(name, call, ctx) {
  const tool = String(call.tool || '')
  if (tool === 'ToolSearch') return null
  const own = folders(name, ctx).read
  if (tool === 'Read') return pathReason(call.file_path, own, 'Read of ' + call.file_path)
  const why = pathReason(call.path, own, tool + ' path')
  if (why) return why
  if (tool === 'Glob') return patternReason(call.pattern, own, false)
  // Grep: a single document, or a folder searched only through a glob (or a type) of document files.
  if (call.glob !== undefined) return patternReason(call.glob, own, true)
  if (call.type !== undefined) return /^[A-Za-z0-9]+$/.test(String(call.type)) && SAFE_EXT.has(String(call.type).toLowerCase()) ? null : 'Grep type must be a document type such as md'
  const ext = (/\.([A-Za-z0-9]+)$/.exec(segments(normalize(call.path) || '').pop() || '') || [])[1]
  return ext && SAFE_EXT.has(ext.toLowerCase()) ? null : 'Grep searches a folder only with a glob ending in a document type, such as **/*.md'
}

// What each feed.py command takes. A flag's value is checked by its kind:
// 'in' a file or folder in the librarian's folders, 'wiki' a file in the wiki writer's folder,
// 'url' a web address, 'local' the transcriber on this computer, 'env' the owner's env file, 1 any text, 0 no value.
const COMMON = { '--env': 'env', '--helper': 0 }
const FEED_ARGS = {
  add: { flags: { '--kind': 1, '--ref': 1, '--title': 1, '--date': 1, '--file': 'in', '--stdin': 0, '--remove': 0 }, args: [] },
  web: { flags: { '--crawl': 0, '--max': 1 }, args: ['url'] },
  doc: { flags: {}, args: ['in'] },
  folder: { flags: {}, args: ['in'] },
  transcribe: { flags: { '--whisper': 'local', '--kind': 1 }, args: ['in'] },
  youtube: { flags: { '--max': 1 }, args: ['url'] },
  search: { flags: { '--k': 1, '--kinds': 1 }, args: [1] },
  stats: { flags: {}, args: [] },
  'wiki-put': { flags: {}, args: [1, 1, 'wiki'] },
  'wiki-list': { flags: {}, args: [] },
}

function valueReason(kind, value, own, flag) {
  const what = flag ? flag + ' ' + value : value
  if (kind === 'in') return pathReason(value, own.feed || [], what)
  if (kind === 'wiki') return pathReason(value, own.wiki || [], what)
  if (kind === 'url') {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) && !/^https?:\/\//i.test(value)) return 'only web addresses (http or https) are allowed'
    return /^\S+$/.test(value) ? null : 'a web address has no spaces'
  }
  if (kind === 'local') return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/i.test(value) ? null : 'the transcriber must be the one on this computer (http://127.0.0.1:port)'
  if (kind === 'env') {
    const want = normalize(own.env || '')
    const got = normalize(value)
    return want && got && want.toLowerCase() === got.toLowerCase() ? null : '--env must be the owner\'s own env file'
  }
  return null
}

// The arguments after feed.py's command: every flag known, each once, every path in the helper's own folders.
function feedArgsReason(command, rest, own) {
  const spec = FEED_ARGS[command]
  if (!spec) return 'unknown feed.py command'
  const flags = { ...COMMON, ...spec.flags }
  const seen = new Map()
  const args = []
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]
    if (word.startsWith('-')) {
      const eq = word.indexOf('=')
      const flag = eq > 0 ? word.slice(0, eq) : word
      if (!(flag in flags)) return 'feed.py ' + command + ' does not take ' + flag
      if (seen.has(flag)) return flag + ' may be given once'
      let value = null
      if (flags[flag] === 0) {
        if (eq > 0) return flag + ' takes no value'
      } else {
        value = eq > 0 ? word.slice(eq + 1) : rest[++i]
        if (value === undefined) return flag + ' needs a value'
        const why = valueReason(flags[flag], value, own, flag)
        if (why) return why
      }
      seen.set(flag, value)
      continue
    }
    args.push(word)
  }
  if (args.length !== spec.args.length) return 'feed.py ' + command + ' takes ' + spec.args.length + ' value' + (spec.args.length === 1 ? '' : 's') + ' besides its options'
  for (let i = 0; i < args.length; i++) {
    const why = valueReason(spec.args[i], args[i], own)
    if (why) return why
  }
  if (!seen.has('--helper')) return 'a helper runs feed.py with --helper on, so the script checks its files too'
  if (seen.has('--remove')) {
    const file = seen.get('--file')
    if (!file) return '--remove needs --file'
    const why = pathReason(file, own.remove || [], '--remove of ' + file)
    if (why) return why
  }
  return null
}

// null when the command runs this add-on's feed.py with one of the allowed commands and safe arguments,
// else the reason. own: the helper's folders (from folders()); without it only the command is checked.
export function feedCommandReason(command, feedPath, allowed, own) {
  const parsed = shellWords(command)
  if (parsed.why) return parsed.why
  let w = parsed.words
  if (/^(?:.*[\\/])?uv(?:\.exe)?$/i.test(w[0] || '') && w[1] === 'run' && w[2] === '--with' && w[3] === 'pypdf') w = w.slice(4)
  if (!PYTHON.test(w[0] || '')) return 'helpers run only feed.py with python'
  w = w.slice(1)
  if (w[0] === '-3') w = w.slice(1)
  const want = normalize(feedPath)
  const got = normalize(w[0] || '')
  if (!want || !got || got.toLowerCase() !== want.toLowerCase()) return 'helpers run only the add-on\'s own feed.py (' + feedPath + ')'
  if (!allowed.includes(w[1])) return 'this helper may run only these feed.py commands: ' + allowed.join(', ')
  return own ? feedArgsReason(w[1], w.slice(2), own) : null
}

// ctx: { feed, scratch, library, folder }. Returns null to allow the call, or the reason it is refused.
export function helperJudge(name, call, ctx) {
  const h = HELPERS.find(x => x.name === name)
  if (!h) return 'not a YouCloned helper'
  const tool = String(call.tool || '')
  if (READS.has(tool)) return readReason(name, call, ctx)
  if (tool === 'Bash') return feedCommandReason(call.command, ctx.feed, h.commands, folders(name, ctx))
  if (tool === 'Write' || (tool === 'Edit' && name === 'wiki-writer')) {
    const dir = name === 'librarian' ? ctx.scratch : ctx.library
    if (!dir) return 'the helper\'s folder is not known yet'
    if (isEnvFile(call.file_path)) return 'helpers never write an env file'
    if (isKeyFile(call.file_path)) return 'helpers never write a key file'
    return inside(call.file_path, dir) ? null : tool + ' to ' + call.file_path + ' is outside ' + dir
  }
  if (name === 'librarian' && GMAIL_READS.test(tool)) return null
  return tool + ' is not on the ' + name + '\'s list'
}

export function helperDenyText(name, why) {
  return 'YouCloned safety gate refused this call: ' + why + '. The ' + name + ' runs feed.py and writes only in its own folder.'
}
