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

// Windows opens ".env." and ".env " as .env, "name:stream" as a hidden stream inside name, and ENV~1 as a
// short name for a long one. A name counts as what Windows would open, and the tricks are refused outright.
// library/feed.py holds the same rules (win_name, SHORT_NAME); change both together.
const SHORT_NAME = /^[^~\s]{1,6}~\d+(?:\.[^.]{0,3})?$/
const DRIVE = /^[A-Za-z]:$/
const winName = (s) => String(s).replace(/:.*$/, '').replace(/[. ]+$/, '')
const envName = (s) => isEnvFile(s) || isEnvFile(winName(s))
const keyName = (s) => KEY_NAME.test(s) || KEY_NAME.test(winName(s))
export const isKeyFile = (file) => typeof file === 'string' && keyName(segments(String(file).replace(/\\/g, '/')).pop() || '')
export const isEnvPath = (file) => typeof file === 'string' && segments(String(file).replace(/\\/g, '/')).some(envName)

// null, or why a path spelled with a Windows name trick is refused (the drive, such as C:, is fine).
function trickReason(parts) {
  for (const [i, s] of parts.entries()) {
    if (i === 0 && DRIVE.test(s)) continue
    if (s.includes(':')) return 'a name with a colon (a hidden Windows stream) is not allowed'
    if (/[. ]$/.test(s) && s !== '.' && s !== '..') return 'a name that ends in a dot or a space is not allowed'
    if (SHORT_NAME.test(s)) return 'a short Windows name such as ENV~1 is not allowed; use the full name'
  }
  return null
}

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
  if (isEnvPath(n) || isEnvPath(p)) return 'helpers never touch an env file'
  if (isKeyFile(n) || isKeyFile(p)) return 'helpers never touch a key file'
  const trick = trickReason(segments(n)) || trickReason(segments(String(p).replace(/\\/g, '/')))
  if (trick) return trick
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
  const trick = trickReason(parts)
  if (trick) return trick
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
    if (isEnvPath(call.file_path) || isEnvPath(normalize(call.file_path) || '')) return 'helpers never write an env file'
    if (isKeyFile(call.file_path) || isKeyFile(normalize(call.file_path) || '')) return 'helpers never write a key file'
    if (!inside(call.file_path, dir)) return tool + ' to ' + call.file_path + ' is outside ' + dir
    return pathReason(call.file_path, [dir], tool + ' to ' + call.file_path)
  }
  if (name === 'librarian' && GMAIL_READS.test(tool)) return null
  return tool + ' is not on the ' + name + '\'s list'
}

// The paths a feed.py command reads or writes, each with the folders it must stay in (after the gate above passed it).
function feedPaths(command, own) {
  const parsed = shellWords(command)
  if (parsed.why) return []
  const words = parsed.words
  const at = words.findIndex(x => Object.hasOwn(FEED_ARGS, x))
  if (at < 0) return []
  const spec = FEED_ARGS[words[at]]
  const w = words.slice(at + 1)
  const flags = { ...COMMON, ...spec.flags }
  const dirsOf = (kind) => kind === 'in' ? own.feed || [] : kind === 'wiki' ? own.wiki || [] : null
  const out = []
  let n = 0
  for (let i = 0; i < w.length; i++) {
    const word = w[i]
    if (word.startsWith('-')) {
      const eq = word.indexOf('=')
      const kind = flags[eq > 0 ? word.slice(0, eq) : word]
      if (kind === 0 || kind === undefined) continue
      const value = eq > 0 ? word.slice(eq + 1) : w[++i]
      if (dirsOf(kind)) out.push({ path: value, dirs: dirsOf(kind) })
      continue
    }
    const kind = spec.args[n++]
    if (dirsOf(kind)) out.push({ path: word, dirs: dirsOf(kind) })
  }
  return out
}

// Where a path lands, every link followed: { landed, stat } or { why }. A file not there yet (a Write) lands in
// its nearest folder that is there, plus the rest of its name. stat: (path) => $.fs.stat(path, { resolve: true }).
async function landing(p, stat) {
  const n = normalize(p)
  if (!n) return { why: p + ' must be a full path' }
  const drive = /^[a-z]:/.test(n) ? n.slice(0, 2) : ''
  const parts = segments(n.slice(drive.length))
  const rest = []
  while (true) {
    const here = drive + '/' + parts.join('/')
    let st = null
    try { st = await stat(here) } catch (err) {
      if (!/ENOENT|no such|not found|missing/i.test(String(err?.code || '') + ' ' + String(err?.message || err))) return { why: 'could not tell where ' + p + ' leads' }
    }
    if (st) {
      if (!st.realPath) return { why: p + ' goes through a link that leads nowhere, and helpers never follow links' }
      const base = normalize(String(st.realPath).replace(/^\\\\\?\\/, ''))
      if (!base) return { why: 'could not tell where ' + p + ' leads' }
      return { landed: base.replace(/\/$/, '') + (rest.length ? '/' + rest.join('/') : ''), stat: rest.length ? null : st }
    }
    if (!parts.length) return { why: 'could not tell where ' + p + ' leads' }
    rest.unshift(parts.pop())
  }
}

// null, or why a call is refused once links are followed: each path the call names must land exactly where its
// spelling says, inside the helper's own folder (a link anywhere on the way, even to a file next to it, is refused),
// never on an env or key file, and never on a second name (a hard link) for the env file.
// fsx: { stat: (path) => FsStat with realPath, list: (dir) => FsEntry[] }. Run it after helperJudge allowed the call.
export async function helperLinkReason(name, call, ctx, fsx) {
  const own = folders(name, ctx)
  const tool = String(call.tool || '')
  let todo = []
  if (tool === 'Read') todo = [{ path: call.file_path, dirs: own.read }]
  else if (tool === 'Grep' || tool === 'Glob') todo = [{ path: call.path, dirs: own.read, scan: tool === 'Grep' }]
  else if (tool === 'Write' || tool === 'Edit') todo = [{ path: call.file_path, dirs: own.write }]
  else if (tool === 'Bash') todo = feedPaths(call.command, own)
  if (!todo.length) return null
  const env = own.env ? await landing(own.env, fsx.stat) : null
  for (const t of todo) {
    const dir = t.dirs.filter(Boolean).find(d => inside(t.path, d))
    if (!dir) return t.path + ' is outside the helper\'s folders'
    const got = await landing(t.path, fsx.stat)
    if (got.why) return got.why
    const base = await landing(dir, fsx.stat)
    if (base.why) return base.why
    const rel = normalize(t.path).slice(normalize(dir).length)
    if (got.landed.toLowerCase() !== (base.landed + rel).toLowerCase()) return t.path + ' goes through a link (a shortcut to another place), and helpers never follow links'
    if (isEnvPath(got.landed)) return 'helpers never touch an env file'
    if (isKeyFile(got.landed)) return 'helpers never touch a key file'
    const st = got.stat
    if (st && env?.stat && st.kind === 'file' && st.size > 0 && st.size === env.stat.size && st.mtimeMs === env.stat.mtimeMs) return t.path + ' looks like a second name for the env file, and helpers never touch it'
    if (t.scan && st?.kind === 'dir') {
      const why = await linkInside(t.path, fsx.list)
      if (why) return why
    }
  }
  return null
}

// A Grep over a folder reads every file under it: refuse when any of them is a link. Big folders are searched in parts.
async function linkInside(dir, list, cap = 5000) {
  const queue = [dir]
  let seen = 0
  while (queue.length) {
    const d = queue.shift()
    let entries
    try { entries = await list(d) } catch { return 'could not look inside ' + d }
    for (const e of entries) {
      if (++seen > cap) return d + ' holds too many files to search at once; search one folder inside it'
      if (e.isLink) return d + '/' + e.name + ' is a link (a shortcut to another place), and helpers never follow links'
      if (e.kind === 'dir') queue.push(d.replace(/[\\/]$/, '') + '/' + e.name)
    }
  }
  return null
}

// The whole gate for one helper call: the spelling first, then where every path lands once links are followed.
export async function helperGate($, name, call, ctx) {
  const no = helperJudge(name, call, ctx)
  if (no) return no
  return helperLinkReason(name, call, ctx, { stat: (p) => $.fs.stat(p, { resolve: true }), list: (p) => $.fs.list(p) })
}

export function helperDenyText(name, why) {
  return 'YouCloned safety gate refused this call: ' + why + '. The ' + name + ' runs feed.py and writes only in its own folder.'
}
