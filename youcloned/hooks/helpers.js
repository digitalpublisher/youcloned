// The two feed-me helpers and their safety gate.
//   librarian    runs on Haiku: puts the owner's history into their library with library/feed.py
//   wiki-writer  runs on Sonnet: reads the library and writes the wiki pages in <clone folder>/Library
// Their instructions live in the add-on's agents folder (agents/<name>.md: frontmatter, then the prompt).
// The gate is code, not a request in the prompt: a helper may run only feed.py (and only its own
// commands), write only in its own folder, and the librarian may use only Gmail's two look-up tools.

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

// null when the command runs this add-on's feed.py with one of the allowed commands, else the reason.
export function feedCommandReason(command, feedPath, allowed) {
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
  return null
}

// ctx: { feed, scratch, library }. Returns null to allow the call, or the reason it is refused.
export function helperJudge(name, call, ctx) {
  const h = HELPERS.find(x => x.name === name)
  if (!h) return 'not a YouCloned helper'
  const tool = String(call.tool || '')
  if (READS.has(tool)) {
    const target = call.file_path ?? call.path
    return typeof target === 'string' && isEnvFile(target) ? 'helpers never open the env file' : null
  }
  if (tool === 'Bash') return feedCommandReason(call.command, ctx.feed, h.commands)
  if (tool === 'Write' || (tool === 'Edit' && name === 'wiki-writer')) {
    const dir = name === 'librarian' ? ctx.scratch : ctx.library
    if (!dir) return 'the helper\'s folder is not known yet'
    if (isEnvFile(call.file_path)) return 'helpers never write an env file'
    return inside(call.file_path, dir) ? null : tool + ' to ' + call.file_path + ' is outside ' + dir
  }
  if (name === 'librarian' && GMAIL_READS.test(tool)) return null
  return tool + ' is not on the ' + name + '\'s list'
}

export function helperDenyText(name, why) {
  return 'YouCloned safety gate refused this call: ' + why + '. The ' + name + ' runs feed.py and writes only in its own folder.'
}
