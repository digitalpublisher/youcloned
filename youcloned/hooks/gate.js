// The crew safety gate: decides whether one tool call a crew member makes may run.
// judge(call, crewDir) returns null to allow it, or a reason string to refuse it.
// Rule: a crew member may read anything, write only inside its own crew folder,
// and call only connector tools whose names read as look-ups. It can't post, send,
// buy, cancel, refund or delete; a person does that after reading the draft.

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'ToolSearch', 'TodoWrite'])
const WRITE_TOOLS = { Write: 'file_path' }

// A connector tool is allowed only when the first word of its own name (after
// mcp__server__) is a look-up word and no word in the name is a change word.
const LOOKUP = new Set(['get', 'list', 'search', 'read', 'fetch', 'query', 'find', 'view', 'retrieve', 'show', 'lookup', 'describe', 'count'])
const CHANGE = new Set(['send', 'post', 'reply', 'create', 'delete', 'remove', 'trash', 'update', 'edit', 'write', 'set', 'add',
  'archive', 'label', 'unlabel', 'move', 'mark', 'draft', 'publish', 'upload', 'refund', 'cancel', 'charge', 'buy', 'purchase',
  'pay', 'invite', 'grant', 'revoke', 'ban', 'block', 'modify', 'patch', 'put', 'save', 'submit', 'schedule', 'forward', 'spam'])

// "getThread", "Get-Thread" and "get_thread" all become ["get", "thread"].
function nameWords(name) {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function isLookup(name) {
  const words = nameWords(name)
  return words.length > 0 && LOOKUP.has(words[0]) && !words.some(w => CHANGE.has(w))
}

// Path helpers that work for macOS, Linux and Windows spellings.
export function normalize(p) {
  let s = String(p || '').trim().replace(/^['"]|['"]$/g, '').replace(/\\/g, '/')
  const drive = /^[A-Za-z]:\//.test(s) ? s.slice(0, 2).toLowerCase() : ''
  if (drive) s = s.slice(2)
  if (!s.startsWith('/')) return null
  const out = []
  for (const part of s.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return drive + '/' + out.join('/')
}

export function inside(p, dir) {
  const n = normalize(p)
  const d = normalize(dir)
  return n !== null && d !== null && (n === d || n.startsWith(d + '/'))
}

export function judge(call, crewDir) {
  const tool = String(call.tool || '')
  if (READ_TOOLS.has(tool)) return null
  if (tool in WRITE_TOOLS) {
    const p = call[WRITE_TOOLS[tool]]
    return inside(p, crewDir) ? null : tool + ' to ' + p + ' is outside the crew folder ' + crewDir
  }
  if (tool.startsWith('mcp__')) {
    const own = tool.split('__').slice(2).join('__')
    return isLookup(own) ? null : tool + ' can change something outside, and only look-up tools are allowed'
  }
  return tool + ' is not on the crew\'s read-and-draft list'
}

export function denyText(why) {
  return 'YouCloned safety gate refused this call: ' + why + '. The crew reads and drafts only; ' +
    'write your draft into your crew folder and a person will send it.'
}
