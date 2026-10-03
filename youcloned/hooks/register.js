// YouCloned: the customer's AI clone inside the Claude app.
// - /youcloned setup interviews the customer and saves their rules file (checked in code by save_setup).
// - Every conversation reads the rules file (prompt.context).
// - The YouCloned pane: Do, Crew, Voice and Skills tabs.
// - "Check with Codex" runs the customer's own Codex on Claude's work and puts the answer in the chat.
// - Crew templates (support drafter, inbox sorter) run as subagents behind a safety gate in code.
// - Jon's instructions (setup interview, crew) live on SkillKey and load when needed, never as files here.

import { judge, denyText } from './gate.js'
import { RULES_NAME, checkSetup, rulesMarkdown } from './rules.js'
import { heroSvg, crewSvg, appsSvg, W as PANEL_W } from './panel.js'

const PANE = 'youcloned'
const TABS = [['home', 'Home', 'h'], ['do', 'Do', 'd'], ['crew', 'Crew', 'r'], ['voice', 'Voice', 'v'], ['skills', 'Skills', 'k']]
const CREW = [
  { name: 'support', title: 'Support', what: 'Drafts answers to customer questions in your voice' },
  { name: 'inbox', title: 'Inbox', what: 'Sorts your new email and drafts the replies that need you' },
]
const SCHEDULES = [{ value: '0', label: 'Only when I press Run' }, { value: '60', label: 'Every hour' }, { value: '240', label: 'Every 4 hours' }]
const DO = [
  { key: 'sales-letter', label: 'Write a sales letter', hint: 'For one of your offers, in your voice', hotkey: '1',
    prompt: 'Write a sales letter for one of my offers. If I sell more than one thing, ask me which one first. Follow my YouCloned rules for voice and brand, and save it as a file in my YouCloned folder.' },
  { key: 'email-series', label: 'Write an email series', hint: 'Welcome, launch or promo', hotkey: '2',
    prompt: 'Write an email series for my business. Ask me first whether it is a welcome, launch or promo series and which offer it is for. Follow my YouCloned rules, and save it as a file in my YouCloned folder.' },
  { key: 'web-page', label: 'Build a web page', hint: 'Your copy and your brand, one page', hotkey: '3',
    prompt: 'Build me a one-page website for my business as a single HTML file in my YouCloned folder. Use my YouCloned rules for the copy, colors and fonts, and show me how to open it when it is done.' },
  { key: 'offer', label: 'Plan an offer', hint: 'Price, bonuses and guarantee', hotkey: '4',
    prompt: 'Help me plan a new offer for my audience: what it is, the price, the bonuses and the guarantee. Ask me a few questions first, then write the plan to a file in my YouCloned folder.' },
]

let interactive = true
let home = ''
let project = null          // the customer's YouCloned folder, once setup has saved
let tab = 'home'
let codex = { busy: false, note: '' }
let crew = {}               // name -> { running, lastRun, note, every, drafts }
const crewIds = new Map()   // agentId -> crew name
const notCrew = new Set()
const gatePassed = new Set() // tool_use_ids of crew calls the gate allowed
let skills = []             // the skills this plugin ships
let skillKey = false        // the SkillKey connector is on in this session
let skillKeyServer = null   // its name for $.mcp.call: "claude.ai SkillKey" in the terminal, an id in the desktop app
const crewReady = new Set() // crew members registered with their instructions from SkillKey
const notOwned = new Set()  // YouCloned skills SkillKey says this account does not have (their plan decides)
let cloneHere = false       // this session runs in the customer's clone folder
let watched = false         // a person is looking at this session (terminal or desktop app)
let dashOn = false          // the dashboard and its timers are running for this session
let codexReady = false      // Codex is installed on this computer
let everywhere = false      // after setup, YouCloned shows in every session unless the owner turns it off
let live = { claudePct: null, claudeLabel: '', words: null } // numbers the strip and dashboard show

// The owner's preferences, a small file in their clone folder they can open and change.
const PREFS_NAME = 'YouCloned preferences.json'
// when_claude_starts: "dashboard" (the full dashboard in Claude's browser pane), "panel" (the small one), or "nothing".
const PREFS_DEFAULT = { when_claude_starts: 'dashboard' }
const START_CHOICES = ['dashboard', 'panel', 'nothing']

async function readPrefs($) {
  if (!project) return { ...PREFS_DEFAULT }
  const file = project + '/' + PREFS_NAME
  try {
    if (await $.fs.exists(file)) {
      const saved = JSON.parse(await $.fs.read(file))
      // 0.5.4 wrote a yes/no switch; false meant stay closed.
      if (saved.when_claude_starts === undefined && saved.open_youcloned_when_claude_starts === false) saved.when_claude_starts = 'nothing'
      delete saved.open_youcloned_when_claude_starts
      return { ...PREFS_DEFAULT, ...saved }
    }
    await $.fs.write(file, JSON.stringify(PREFS_DEFAULT, null, 2) + '\n')
  } catch {}
  return { ...PREFS_DEFAULT }
}

async function writePrefs($, change) {
  const prefs = { ...(await readPrefs($)), ...change }
  if (project) await $.fs.write(project + '/' + PREFS_NAME, JSON.stringify(prefs, null, 2) + '\n')
  return prefs
}

const DASH_PORT = 4600
const DASH_URL = 'http://127.0.0.1:' + DASH_PORT
// One-tap jobs: the strip above Claude's message box and the dashboard both start these.
const JOBS = [
  { label: 'VSL lead', hint: 'Jon\'s Lead Writer', text: 'Write my VSL lead with Jon\'s VSL Lead Writer skill. Ask me which offer first if I have more than one.' },
  { label: 'Sales page', hint: 'Your offer, your brand', text: 'Build a sales page for one of my offers with Jon\'s sales page skill. Ask me which offer first if I have more than one.' },
  { label: 'YouTube video', hint: 'Topic, script, thumbnails', text: 'Help me make my next YouTube video: topic, script in my voice, then the edit and two thumbnails.' },
  { label: 'Clear my inbox', hint: 'Your inbox helper sorts it', text: '/youcloned crew inbox' },
]

function dataDir() {
  return home + '/.youcloned'
}

// Runs a job from the strip or the dashboard: YouCloned commands run here, anything else goes to the chat as the owner's words.
async function runJob($, text) {
  const t = String(text || '').trim()
  if (!t) return
  const m = /^\/youcloned\s*(.*)$/i.exec(t)
  if (!m) { try { await $.prompt.submit({ text: t, asUser: true }) } catch (err) { $.ui.log('job not sent: ' + String(err)) } return }
  const args = m[1].trim()
  const word = args.split(/\s+/)[0].toLowerCase()
  if (word === 'setup') return startSetup($)
  if (word === 'codex') return codexButton($)
  if (word === 'crew') { $.ui.toast(await runCrew($, (args.split(/\s+/)[1] || '').toLowerCase())); return }
}

// Reads jobs the dashboard queued and starts them.
async function drainJobs($) {
  const file = dataDir() + '/jobs.jsonl'
  if (!(await $.fs.exists(file))) return
  const text = await $.fs.read(file)
  if (!text.trim()) return
  await $.fs.write(file, '')
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { await runJob($, JSON.parse(line).text) } catch {}
  }
}

// Plan usage from Claude itself, words from SkillKey; written where the dashboard reads them.
async function refreshLive($, withWords) {
  try {
    const u = await $.session.usage()
    const w = (u.rateLimits || []).find(r => r.kind === 'five_hour') || (u.rateLimits || [])[0]
    if (w) {
      live.claudePct = w.percentUsed
      let label = 'Claude plan · this 5 hours'
      if (w.resetsAt) {
        const d = new Date(w.resetsAt)
        label = 'Claude plan · resets ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      }
      live.claudeLabel = label
    }
  } catch {}
  if (withWords) {
    try {
      const r = await skillKeyCall($, 'word_balance', {})
      const txt = (r.content || []).map(c => c.text || '').join(' ')
      const m = txt.replace(/,/g, '').match(/(\d+)\s*words/i) || txt.replace(/,/g, '').match(/(\d{3,})/)
      if (m) live.words = Number(m[1])
    } catch {}
  }
  try {
    const name = project ? ((await readRules($)) || '').match(/^#+\s*Who I am\s*\n+([^\n]+)/m) : null
    await $.fs.write(dataDir() + '/state.json', JSON.stringify({ ...live, name: name ? name[1].trim().split(/[ ,]/)[0] : undefined, at: await $.clock.now() }))
  } catch {}
  $.ui.invalidate('ui.render')
}

async function dashboardUp($) {
  try { const r = await $.http.fetch(DASH_URL + '/state.json'); return r && r.status === 200 } catch { return false }
}

// Finds Python: the desktop app gives add-ons a short program path, so known places are checked first.
async function findPython($) {
  for (const p of ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/Library/Frameworks/Python.framework/Versions/Current/bin/python3', '/usr/bin/python3']) {
    if (await $.fs.exists(p)) return p
  }
  return 'python3'
}

// Tells Claude's Browser pane how to start the dashboard, then starts it if it isn't already running.
async function startDashboard($, cwd) {
  const python = await findPython($)
  const server = $.plugin.root + '/dashboard/server.py'
  const entry = { name: 'YouCloned', runtimeExecutable: python, runtimeArgs: [server, String(DASH_PORT)], port: DASH_PORT, autoPort: false }
  const launch = cwd + '/.claude/launch.json'
  let conf = { version: '0.0.1', configurations: [] }
  try { if (await $.fs.exists(launch)) conf = JSON.parse(await $.fs.read(launch)) } catch { conf = null }
  if (conf) {
    conf.configurations = (conf.configurations || []).filter(c => c.name !== 'YouCloned')
    conf.configurations.push(entry)
    try { await $.fs.write(launch, JSON.stringify(conf, null, 2) + '\n') } catch {}
  }
  if (!(await dashboardUp($))) {
    try { const run = $.process.spawn([python, server, String(DASH_PORT)]); if (run && typeof run.catch === 'function') run.catch(() => {}) } catch (err) { $.ui.log('dashboard did not start: ' + String(err)) }
  }
}

// Starts the dashboard and the timers that feed it, once per session.
async function turnOn($, cwd) {
  if (dashOn) return
  dashOn = true
  await startDashboard($, cwd || (await $.session.cwd()))
  $.clock.every(1500, () => drainJobs($))
  $.clock.every(20000, () => refreshLive($, false))
  $.clock.every(300000, () => refreshLive($, true))
  $.clock.after(2000, () => refreshLive($, true))
  // YouCloned opens with Claude the way the owner's preferences say: the full dashboard unless they chose otherwise.
  const start = (await readPrefs($)).when_claude_starts
  if (start === 'panel') $.clock.after(800, () => openPane($, false))
  else if (start !== 'nothing') $.clock.after(1500, () => showDashboard($))
  try { codexReady = !!(await findCodex($)) } catch {}
}

// Opens the YouCloned panel, or closes it when it is already open.
async function togglePane($) {
  let open = false
  try { open = (await $.ui.panes()).some(p => (p.id || p) === PANE) } catch {}
  if (open) { try { await $.ui.close({ id: PANE }) } catch { try { await $.ui.close(PANE) } catch {} } return }
  await openPane($, true)
}

// Opens the full dashboard in Claude's browser pane with the desktop app's own browser tools: start the
// dashboard (launch.json "YouCloned"), open the pane on its address, then ask the app whether the pane shows.
// If the app keeps it hidden, Claude is asked to open it (one line in the chat). Without the browser tools
// (the terminal, an older app) the small panel opens instead.
async function browserCall($, tool, args) {
  for (const server of ['Claude_Browser', 'Claude Browser']) {
    try {
      const r = await $.mcp.call(server, tool, args)
      if (r && !r.isError) return (r.content || []).map(c => c.text || '').join('\n') || 'ok'
    } catch {}
  }
  return null
}

async function showDashboard($) {
  const started = await browserCall($, 'preview_start', { name: 'YouCloned' })
  if (started === null) { await openPane($, false); return false }
  await browserCall($, 'preview_start', { url: DASH_URL + '/' })
  const ctx = (await browserCall($, 'tabs_context', {})) || ''
  if (/"browserOpen":\s*true/.test(ctx) && !/hidden/i.test(ctx)) return true
  await openDashboard($)
  return true
}

async function openDashboard($) {
  try { await $.prompt.submit({ text: 'Open the YouCloned dashboard in the Browser pane: start the "YouCloned" preview from .claude/launch.json (it starts its own server on port ' + DASH_PORT + '), then show it. No other work.' }) } catch (err) { $.ui.log('dashboard request not sent: ' + String(err)) }
}

function crewDir(name) {
  return project ? project + '/crew/' + name : null
}

function expandHome(p) {
  const s = String(p || '').trim()
  if (s === '~') return home
  if (s.startsWith('~/')) return home + s.slice(1)
  return s
}

async function loadState($) {
  home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
  everywhere = (await $.store.get('everywhere')) === true
  const saved = await $.store.get('project')
  project = typeof saved === 'string' && saved ? saved : null
  const stored = (await $.store.get('crew')) || {}
  crew = {}
  for (const c of CREW) crew[c.name] = { running: false, lastRun: 0, note: '', every: 0, drafts: [], ...(stored[c.name] || {}), running: false }
}

async function saveCrew($) {
  const out = {}
  for (const c of CREW) out[c.name] = { lastRun: crew[c.name].lastRun, note: crew[c.name].note, every: crew[c.name].every }
  await $.store.set('crew', out)
}

async function refreshDrafts($) {
  for (const c of CREW) {
    const dir = crewDir(c.name)
    let names = []
    if (dir && (await $.fs.exists(dir + '/drafts'))) {
      const entries = await $.fs.list(dir + '/drafts')
      names = entries.filter(x => x.kind === 'file' && x.name.endsWith('.md')).sort((a, b) => b.mtimeMs - a.mtimeMs).map(x => x.name)
    }
    crew[c.name].drafts = names
  }
}

// Question files in the support inbox that no draft names on its "Question:" line yet.
async function waitingQuestions($) {
  const dir = crewDir('support')
  if (!(await $.fs.exists(dir + '/inbox'))) return []
  const questions = (await $.fs.list(dir + '/inbox')).filter(x => x.kind === 'file' && !x.name.startsWith('.')).map(x => x.name)
  const answered = new Set()
  for (const folder of ['/drafts', '/done']) {
    if (!(await $.fs.exists(dir + folder))) continue
    for (const d of await $.fs.list(dir + folder)) {
      if (d.kind !== 'file' || !d.name.endsWith('.md')) continue
      const m = (await $.fs.read(dir + folder + '/' + d.name)).match(/^Question:\s*(.+)$/m)
      if (m) answered.add(m[1].trim().split('/').pop())
    }
  }
  return questions.filter(q => !answered.has(q))
}

async function loadSkills($) {
  skills = []
  const root = $.plugin.root + '/skills'
  if (!(await $.fs.exists(root))) return
  for (const entry of await $.fs.list(root)) {
    if (entry.kind !== 'dir') continue
    let description = ''
    try {
      const text = await $.fs.read(root + '/' + entry.name + '/SKILL.md')
      const m = text.match(/^description:\s*(.+)$/m)
      description = m ? m[1].split('. ')[0] : ''
    } catch {}
    skills.push({ name: entry.name, description })
  }
}

// SkillKey is the connector with both start_skill and word_balance. The desktop app names
// connectors by an id instead of "claude.ai SkillKey", so it is found by its tools.
function skillKeyFrom(names) {
  const servers = new Set(names.map(n => (/^mcp__(.+)__word_balance$/.exec(n) || [])[1]).filter(Boolean))
  for (const n of names) {
    const m = /^mcp__(.+)__start_skill$/.exec(n)
    if (m && servers.has(m[1])) return m[1]
  }
  return null
}

async function checkSkillKey($) {
  try {
    const names = (await $.tool.list()).map(t => typeof t === 'string' ? t : t.name || '')
    const found = skillKeyFrom(names)
    if (found) { skillKeyServer = found; await $.store.set('skillKeyServer', found) }
  } catch {}
  if (!skillKeyServer) { const saved = await $.store.get('skillKeyServer'); if (typeof saved === 'string' && saved) skillKeyServer = saved }
  skillKey = !!skillKeyServer
}

async function skillKeyCall($, tool, args) {
  const names = skillKeyServer ? [skillKeyServer] : ['claude.ai SkillKey']
  if (skillKeyServer && skillKeyServer !== 'claude.ai SkillKey') names.push('claude.ai SkillKey')
  let last
  for (const server of names) {
    try {
      const r = await $.mcp.call(server, tool, args)
      if (r && !r.isError) {
        if (server !== skillKeyServer) { skillKeyServer = server; skillKey = true; await $.store.set('skillKeyServer', server) }
        return r
      }
      last = r
    } catch (err) { last = err }
  }
  throw new Error('SkillKey did not answer: ' + String(last && (last.message || last)).slice(0, 200))
}

// Jon's instructions for one YouCloned skill, from SkillKey. Only the part between the markers
// is used, so SkillKey's own notes (word balance, run_skill) never reach the crew.
async function fromSkillKey($, slug) {
  try {
    const r = await skillKeyCall($, 'start_skill', { skill: slug })
    const text = (r.content || []).map(c => c.text || '').join('\n')
    const m = /<<<YOUCLONED>>>\n([\s\S]*?)\n<<<END YOUCLONED>>>/.exec(text)
    if (m) { notOwned.delete(slug); return m[1].trim() }
    if (/not on this account/i.test(text)) notOwned.add(slug)
    return null
  } catch (err) {
    $.ui.log('SkillKey ' + slug + ': ' + String(err).slice(0, 200))
    return null
  }
}

const PRO_ONLY = (title) => 'The ' + title + ' helper comes with YouCloned Pro. Your SkillKey account has YouCloned Free, so this one stays off.'
const NEEDS_SKILLKEY = 'YouCloned loads its instructions from SkillKey, and SkillKey is not connected in this Claude app yet. Connect SkillKey (Settings, Connectors), then try again.'

async function readRules($) {
  if (!project) return null
  try { return await $.fs.read(project + '/' + RULES_NAME) } catch { return null }
}

async function findCodex($) {
  try {
    const r = await $.process.run(['codex', '--version'], { timeoutMs: 15000 })
    if (r.exitCode === 0) return 'codex'
  } catch {}
  const candidates = [
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    home + '/.local/bin/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ]
  for (const path of candidates) {
    if (await $.fs.exists(path)) return path
  }
  return null
}

async function lastAnswer($) {
  const messages = await $.session.messages()
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && String(messages[i].text || '').trim()) return String(messages[i].text).slice(-6000)
  }
  return ''
}

// Runs the customer's own Codex, read-only, and returns what it said.
async function codexCheck($, question) {
  const bin = await findCodex($)
  if (!bin) return 'Codex is not installed on this computer. Install the Codex app (or the ChatGPT desktop app) from openai.com, sign in once, then press Check with Codex again.'
  const cwd = await $.session.cwd()
  let changed = false
  try {
    const git = await $.process.run(['git', 'status', '--porcelain'], { cwd, timeoutMs: 15000 })
    changed = git.exitCode === 0 && git.stdout.trim().length > 0
  } catch {}
  try {
    if (changed && !question) {
      const r = await $.process.run([bin, 'review', '--uncommitted'], { cwd, timeoutMs: 600000 })
      const text = (r.stdout || '').trim()
      return text || 'Codex finished without a review. What it printed: ' + (r.stderr || '').trim().slice(-1500)
    }
    const work = await lastAnswer($)
    const prompt = question
      ? question
      : 'You are checking work another AI (Claude) just did in this folder. Its last answer was:\n\n<<<\n' + work + '\n>>>\n\n' +
        'Read the files it mentions. List the problems you find, most serious first, each with the file and what to change. If it looks right, say so in one line.'
    const outFile = home + '/.youcloned/codex-last.md'
    await $.fs.write(outFile, '')
    const r = await $.process.run([bin, 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '-C', cwd, '-o', outFile, prompt], { cwd, timeoutMs: 600000 })
    const text = (await $.fs.read(outFile)).trim()
    if (text) return text
    return 'Codex finished without an answer (exit ' + r.exitCode + '). What it printed: ' + ((r.stderr || r.stdout || '').trim().slice(-1500))
  } catch (err) {
    return 'Codex could not run: ' + String(err).slice(0, 400) + '. If it asks you to sign in, open the Codex app once and sign in, then try again.'
  }
}

async function codexButton($) {
  if (codex.busy) return
  codex = { busy: true, note: 'Codex is checking the work…' }
  $.ui.invalidate('ui.render')
  const answer = await codexCheck($, '')
  codex = { busy: false, note: 'Codex finished. Its answer is in the chat.' }
  $.ui.invalidate('ui.render')
  $.prompt.submit({ text: 'The customer pressed Check with Codex. Codex (OpenAI) checked the work and said:\n\n' + answer +
    '\n\nTell the customer in a few lines which points you agree with and what you would change. Do not change anything until they say so.' })
}

async function isCrew($, e) {
  const id = e.agentId
  if (!id) return null
  if (crewIds.has(id)) return crewIds.get(id)
  if (notCrew.has(id)) return null
  const agents = await $.agent.list()
  const a = agents.find(x => x.id === id)
  const m = a && /^youcloned:(.+)$/.exec(a.type)
  if (m && CREW.some(c => c.name === m[1])) {
    crewIds.set(id, m[1])
    return m[1]
  }
  if (a) notCrew.add(id)
  return null
}

async function registerCrew($) {
  for (const c of CREW) {
    if (crewReady.has(c.name)) continue
    const prompt = await fromSkillKey($, 'youcloned-crew-' + c.name)
    if (!prompt) continue
    await $.agent.register({
      name: c.name,
      description: 'YouCloned crew, ' + c.title + ': ' + c.what + '. Reads and drafts only.',
      prompt,
      disallowedTools: ['Bash', 'Edit', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task'],
      maxTurns: 60,
      omitClaudeMd: true,
    })
    crewReady.add(c.name)
  }
}

async function runCrew($, name) {
  const c = CREW.find(x => x.name === name)
  if (!c) return 'There is no crew member called ' + name + '.'
  if (!project) return 'Set up YouCloned first (/youcloned setup), so the crew knows who you are and where to put drafts.'
  if (crew[name].running) return c.title + ' is already working.'
  if (!crewReady.has(name)) { await checkSkillKey($); try { await registerCrew($) } catch {} }
  if (!crewReady.has(name)) return notOwned.has('youcloned-crew-' + name) ? PRO_ONLY(c.title) : NEEDS_SKILLKEY
  const today = new Date(await $.clock.now()).toISOString().slice(0, 10)
  let work = ''
  if (name === 'support') {
    // The crew has no shell, so the plugin finds the questions that have no draft yet.
    const waiting = await waitingQuestions($)
    if (!waiting.length) {
      crew[name].note = 'No new questions in ' + crewDir(name) + '/inbox.'
      $.ui.invalidate('ui.render')
      return crew[name].note
    }
    work = '\nQuestions waiting (one file each):\n' + waiting.map(f => '- ' + crewDir(name) + '/inbox/' + f).join('\n') + '\n'
  }
  const r = await $.agent.spawn({
    subagentType: 'youcloned:' + name,
    description: 'YouCloned crew: ' + c.title,
    prompt: 'Rules file: ' + project + '/' + RULES_NAME + '\nCrew folder: ' + crewDir(name) + '\nToday: ' + today + '\n' + work + '\nDo your job now.',
  })
  if (r.deny || !r.agentId) {
    crew[name].note = 'Could not start: ' + (r.deny || 'no agent id')
    $.ui.invalidate('ui.render')
    return crew[name].note
  }
  crewIds.set(r.agentId, name)
  crew[name].running = true
  crew[name].note = 'Working…'
  $.ui.invalidate('ui.render')
  return c.title + ' started. Drafts land in ' + crewDir(name) + '/drafts, and nothing is sent without you.'
}

function startSetup($) {
  $.prompt.submit({ text: 'Set me up with YouCloned. Use the youcloned:setup skill.', asUser: true })
}

async function openPane($, focus) {
  const pane = { id: PANE, title: 'YouCloned', closeOnEscape: true }
  try { await $.ui.open(focus ? { ...pane, focus: true } : pane) } catch {}
}

function ago(ms, now) {
  if (!ms) return 'never'
  const m = Math.round((now - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago')
  const h = Math.round(m / 60)
  return h + (h === 1 ? ' hour ago' : ' hours ago')
}

export function register(on) {
  // The safety gate runs first, so no crew call reaches a tool without it. It fails closed.
  on('tool.call', async ($, e, next) => {
    const name = await isCrew($, e)
    if (!name) return next(e)
    const why = judge(e, crewDir(name) || '/nowhere')
    if (why) {
      $.ui.log('safety gate refused ' + e.tool + ' for the ' + name + ' crew: ' + why)
      return { deny: denyText(why) }
    }
    if (e.tool_use_id) gatePassed.add(e.tool_use_id)
    return next(e)
  }).catch(async ($, e, next) => {
    if (e.agentId && (crewIds.has(e.agentId) || !notCrew.has(e.agentId))) {
      return { deny: denyText('the gate itself failed (' + next.error.kind + '), so the call was refused') }
    }
    return next(e)
  })

  // A crew call the gate allowed runs without a permission question, since the crew works
  // while nobody watches. A rule of the customer's that denies the call still wins.
  on('tool.check', async ($, e, next) => {
    const decided = await next(e)
    if (!e.tool_use_id || !gatePassed.has(e.tool_use_id)) return decided
    gatePassed.delete(e.tool_use_id)
    return decided && decided.decision === 'ask' ? { decision: 'allow', reason: 'allowed by the YouCloned crew safety gate' } : decided
  })

  // The crew may not start other agents.
  on('agent.spawn', async ($, e, next) => {
    if (e.parentAgentId && crewIds.has(e.parentAgentId)) return { deny: denyText('the crew may not start other agents') }
    return next(e)
  })

  // The crew runs from the pane, the command and the schedule, never by Claude's own choice.
  on('agent.offer', { agent: /^youcloned:/ }, async () => ({ isOffered: false }))

  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive
    await loadState($)
    try { await loadSkills($) } catch {}
    try { await refreshDrafts($) } catch {}
    await checkSkillKey($)
    // YouCloned shows itself only in the clone folder: a folder with the rules file, or the one setup saved.
    try {
      const cwd = await $.session.cwd()
      const rulesHere = await $.fs.exists(cwd + '/' + RULES_NAME)
      cloneHere = rulesHere || !!(project && (cwd === project || cwd.startsWith(project + '/'))) || !!(everywhere && project)
      if (rulesHere) project = cwd
      // The desktop app reports its sessions as not interactive, so it counts by its surface.
      watched = e.isInteractive || e.surface === 'desktop'
      if (cloneHere && watched) await turnOn($, cwd)
    } catch (err) { $.ui.log('YouCloned clone check failed: ' + String(err)) }
    try {
      await $.tool.register({
        name: 'save_setup',
        description: 'Save the customer\'s YouCloned rules file after the youcloned:setup interview. Refuses a setup with an empty section or fewer than two writing samples the customer wrote themselves.',
        inputSchema: {
          type: 'object',
          properties: {
            folder: { type: 'string', description: 'Where their YouCloned work goes; leave out for the default YouCloned folder in their home folder' },
            name: { type: 'string' }, business: { type: 'string' }, offers: { type: 'string' }, audience: { type: 'string' },
            voice: { type: 'string' }, brand: { type: 'string' }, accounts: { type: 'string' },
            voice_samples: { type: 'array', items: { type: 'string' }, description: 'At least two pieces the customer wrote, each a few paragraphs' },
          },
          required: ['name', 'business', 'offers', 'audience', 'voice', 'voice_samples', 'brand', 'accounts'],
        },
      })
    } catch (err) { $.ui.log('save_setup not registered: ' + String(err)) }
    try {
      await $.tool.register({
        name: 'load_setup',
        description: 'Loads the YouCloned setup interview from SkillKey. Call it first whenever the person wants to set up or redo YouCloned, then follow what it returns exactly.',
        inputSchema: { type: 'object', properties: {} },
      })
    } catch (err) { $.ui.log('load_setup not registered: ' + String(err)) }
    try {
      await $.tool.register({
        name: 'codex_check',
        description: 'Ask the customer\'s own Codex (OpenAI) to check work, read-only. With no question it reviews the uncommitted changes, or your last answer and the files it names. Use it when the customer asks for a second opinion or a Codex check.',
        inputSchema: { type: 'object', properties: { question: { type: 'string', description: 'What Codex should check; leave out to check the last piece of work' } } },
      })
    } catch (err) { $.ui.log('codex_check not registered: ' + String(err)) }
    if (cloneHere) { try { await registerCrew($) } catch (err) { $.ui.log('crew not registered: ' + String(err)) } }
    try {
      await $.command.register({
        name: 'youcloned',
        description: 'Open YouCloned. "setup" sets you up, "codex" checks the last work with Codex, "crew support" or "crew inbox" runs a crew member',
        argumentHint: '[setup | on | off | start dashboard|panel|off | codex [question] | crew <support|inbox>]',
        immediate: true,
      })
    } catch (err) { $.ui.log('/youcloned not registered: ' + String(err)) }
    if (watched && cloneHere) {
      // Runs scheduled crew members when their time comes.
      $.clock.every(60000, async () => {
        const now = await $.clock.now()
        for (const c of CREW) {
          const s = crew[c.name]
          if (s.every > 0 && !s.running && now - s.lastRun >= s.every * 60000) await runCrew($, c.name)
        }
      })
    }
    return next(e)
  })

  // The YouCloned strip above Claude's message box: plan, words, the dashboard and one-tap jobs.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!cloneHere) return next(e)
    if (!dashOn) $.clock.after(0, () => turnOn($))
    const { Box, Text, Button, Client } = $.ui.resolve(e)
    const theirs = await next(e)
    // Designed buttons (hooks/tile.js) wherever the surface draws them; Claude's own with number keys elsewhere.
    const chip = (id, label, kind, hotkey, onPress) => Client
      ? Client({ key: 'tile-' + id, module: './tile.js', props: { id, label, kind } })
      : Button({ key: id, label, hotkey, plain: true, onPress })
    const facts = []
    if (live.claudePct != null) facts.push('Claude ' + Math.round(Math.max(0, 100 - live.claudePct)) + '% left')
    if (live.words != null) facts.push(Number(live.words).toLocaleString('en-US') + ' words')
    const strip = Box({ flexDirection: 'column', rowGap: 0, children: [
      Box({ flexDirection: 'row', columnGap: 2, children: [
        Text({ bold: true, color: '#3375d7', children: ['YouCloned'] }),
        Text({ dimColor: true, children: [facts.join(' · ') || 'your clone is on'] }),
      ] }),
      Box({ flexDirection: 'row', columnGap: 2, children: [
        project
          ? chip('yc-open', 'YouCloned', 'chip-primary', '1', () => togglePane($))
          : chip('yc-setup', 'Set up YouCloned', 'chip-primary', '1', () => openDashboard($)),
        ...JOBS.map((j, i) => chip('yc-job-' + i, j.label, 'chip', String(i + 2), () => runJob($, j.text))),
      ] }),
    ] })
    return theirs ? Box({ flexDirection: 'column', children: [strip, theirs] }) : strip
  })

  // Claude's working line says YouCloned is on it.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!cloneHere) return next(e)
    return next({ ...e, props: { ...e.props, suffix: (e.props.suffix || '') + ' · YouCloned' } })
  })

  // Every conversation reads the customer's rules file.
  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    if (!cloneHere) return result
    const rules = await readRules($)
    if (!rules) return result
    const block = { name: 'youcloned', text: 'The owner\'s YouCloned rules, from ' + project + '/' + RULES_NAME +
      '. Follow them in everything you write for this person.\n\n' + rules }
    return { ...result, blocks: [...result.blocks, block] }
  })

  on('tool.call', { tool: 'mcp__youcloned__save_setup' }, async ($, e) => {
    const problems = checkSetup(e)
    if (problems.length) return { result: 'Not saved. Fix these and call save_setup again:\n- ' + problems.join('\n- ') }
    const folder = expandHome(e.folder) || home + '/YouCloned'
    if (!/^([A-Za-z]:)?[\\/]/.test(folder)) return { result: 'Not saved: the folder must be a full path, such as ' + home + '/YouCloned.' }
    await $.fs.write(folder + '/' + RULES_NAME, rulesMarkdown(e))
    for (const c of CREW) {
      await $.fs.write(folder + '/crew/' + c.name + '/drafts/.keep', '')
      if (c.name === 'support') await $.fs.write(folder + '/crew/support/inbox/.keep', '')
    }
    project = folder
    await $.store.set('project', folder)
    everywhere = true
    await $.store.set('everywhere', true)
    await refreshDrafts($)
    $.ui.invalidate('ui.render')
    return { result: 'Saved. Rules file: ' + folder + '/' + RULES_NAME + '. Crew folders: ' + folder + '/crew/support and ' + folder + '/crew/inbox. Every new conversation reads the rules file.' }
  })

  on('tool.call', { tool: 'mcp__youcloned__load_setup' }, async ($) => {
    if (!skillKeyServer) await checkSkillKey($)
    const text = await fromSkillKey($, 'youcloned-setup')
    return { result: text || NEEDS_SKILLKEY + ' Tell the person exactly that, and stop.' }
  })

  // Learns SkillKey's name the moment Claude itself uses it, for apps whose tool list leaves it out.
  on('tool.call', { tool: /^mcp__.+__(list_skills|start_skill|run_skill|word_balance)$/ }, async ($, e, next) => {
    const m = /^mcp__(.+)__(list_skills|start_skill|run_skill|word_balance)$/.exec(e.tool || '')
    if (m && m[1] !== skillKeyServer && !/youcloned/.test(m[1])) {
      skillKeyServer = m[1]; skillKey = true
      try { await $.store.set('skillKeyServer', m[1]) } catch {}
    }
    return next(e)
  })

  on('tool.call', { tool: 'mcp__youcloned__codex_check' }, async ($, e) => {
    return { result: await codexCheck($, String(e.question || '')) }
  })

  on('command.run', { command: 'youcloned' }, async ($, e) => {
    const args = String(e.args || '').trim()
    const word = args.split(/\s+/)[0].toLowerCase()
    if (word === 'setup') {
      startSetup($)
      return {}
    }
    if (word === 'off') {
      everywhere = false
      await $.store.set('everywhere', false)
      return { text: 'YouCloned is off in your other sessions. It still shows in your clone folder' + (project ? ' (' + project + ')' : '') + '. Type /youcloned on to bring it back everywhere.' }
    }
    if (word === 'on') {
      if (!project) return { text: 'Set up YouCloned first with /youcloned setup, then it shows in every session.' }
      everywhere = true
      await $.store.set('everywhere', true)
      return { text: 'YouCloned is on in every Claude session from your next one. Type /youcloned off to turn it off.' }
    }
    if (word === 'start') {
      if (!project) return { text: 'Set up YouCloned first with /youcloned setup.' }
      let pick = (args.split(/\s+/)[1] || 'dashboard').toLowerCase()
      if (/^(off|no|false|none)$/.test(pick)) pick = 'nothing'
      if (/^(on|yes|true|full)$/.test(pick)) pick = 'dashboard'
      if (!START_CHOICES.includes(pick)) return { text: 'Say /youcloned start dashboard, /youcloned start panel or /youcloned start off.' }
      await writePrefs($, { when_claude_starts: pick })
      return { text: pick === 'dashboard' ? 'From your next session, Claude opens with your full YouCloned dashboard.'
        : pick === 'panel' ? 'From your next session, Claude opens with the small YouCloned panel.'
        : 'YouCloned stays closed when Claude starts; press the YouCloned button to open it. Type /youcloned start dashboard to bring it back.' }
    }
    if (word === 'codex') return { text: await codexCheck($, args.slice(5).trim()) }
    if (word === 'crew') {
      const name = args.split(/\s+/)[1] || ''
      return { text: await runCrew($, name.toLowerCase()) }
    }
    if (interactive) {
      await openPane($, true)
      return {}
    }
    return { text: project ? 'YouCloned is set up. Rules file: ' + project + '/' + RULES_NAME : 'YouCloned is not set up yet. Run /youcloned setup.' }
  })

  // A designed button (hooks/tile.js) was pressed.
  on('ui.message', async ($, e, next) => {
    if (!/tile\.js$/.test(String(e.module || ''))) return next(e)
    const id = e.data && typeof e.data === 'object' ? String(e.data.id || '') : ''
    const job = /^(?:home|yc)-job-(\d)$/.exec(id)
    if (job && JOBS[Number(job[1])]) await runJob($, JOBS[Number(job[1])].text)
    else if (id === 'home-crew') { tab = 'crew'; $.ui.invalidate('ui.render') }
    else if (id === 'home-codex') await codexButton($)
    else if (id === 'home-dash' || id === 'yc-setup') openDashboard($)
    else if (id === 'yc-open') await togglePane($)
    return {}
  })

  // A crew member finished.
  on('turn.complete', async ($, e, next) => {
    const name = e.agentId ? crewIds.get(e.agentId) : undefined
    if (!name) return next(e)
    crewIds.delete(e.agentId)
    const s = crew[name]
    s.running = false
    s.lastRun = await $.clock.now()
    s.note = e.isAborted ? 'Stopped before it finished.' : String(e.answer || 'Finished.').trim().split('\n')[0].slice(0, 200)
    try { await refreshDrafts($) } catch {}
    await saveCrew($)
    $.ui.toast('YouCloned ' + CREW.find(c => c.name === name).title + ': ' + s.drafts.length + ' drafts waiting')
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button, Input, Select, Svg, Link, Client } = $.ui.resolve(e)
    // A designed button (hooks/tile.js) where the surface can draw one, Claude's own Button elsewhere.
    const tile = (id, label, sub, kind, onPress) => Client
      ? Client({ key: 'tile-' + id, module: './tile.js', props: { id, label, sub, kind }, flexGrow: 1 })
      : Button({ key: id, label, plain: true, onPress })
    const redraw = () => $.ui.invalidate('ui.render')
    const width = Math.max(30, (e.props.bodyColumns || 60) - 2)
    const now = await $.clock.now()

    const header = Box({ flexDirection: 'row', columnGap: 2, children: [
      Text({ bold: true, children: ['YouCloned'] }),
      Text({ dimColor: true, children: [project ? 'Your rules are on' : 'Not set up yet'] }),
    ] })
    const tabs = Box({ flexDirection: 'row', columnGap: 3, children: TABS.map(([id, label, hotkey]) => Button({
      key: 'tab-' + id, label, hotkey, plain: true, dimColor: tab !== id, onPress: () => { tab = id; redraw() },
    })) })

    let body = []
    if (tab === 'home') {
      const desk = e.surface === 'desktop'
      const left = live.claudePct == null ? null : 100 - live.claudePct
      const reset = live.claudeLabel && live.claudeLabel.includes('resets ') ? live.claudeLabel.split('resets ')[1] : ''
      const waiting = CREW.map(c => ({ c, n: crew[c.name].drafts.length }))
      const lines = waiting.filter(x => x.n).map(x => x.c.title + ' helper: ' + x.n + (x.n === 1 ? ' draft' : ' drafts') + ' waiting for you')
      if (!lines.length) lines.push('Your crew is caught up')
      lines.push('New from Jon: VSL Story, step 2 of 9')
      // No fixed size: the drawing is marked wider than any panel, so the desktop app draws it at the
      // panel's full width and keeps its shape.
      const BIG = 2400
      const pic = (alt, svg, h) => Svg({ alt, source: svg.replace(' width="' + PANEL_W + '" height="' + h + '"', ' width="' + BIG + '" height="' + Math.round(h * BIG / PANEL_W) + '"') })
      if (desk) {
        let name = ''
        try { const m = ((await readRules($)) || '').match(/^#+\s*Who I am\s*\n+([^\n]+)/m); name = m ? m[1].trim().split(/[ ,]/)[0] : '' } catch {}
        body.push(pic('Your day: plan left, Codex and BNSN words', heroSvg({ name, left, reset, words: live.words, codex: codexReady, lines }), 230))
      } else {
        body.push(Text({ bold: true, color: '#3375d7', children: ['YouCloned'] }))
        body.push(Text({ children: ['Claude plan left: ' + (left == null ? '?' : Math.round(left) + '%') + '   BNSN words: ' + (live.words == null ? 'not linked' : Number(live.words).toLocaleString('en-US'))] }))
      }
      body.push(desk
        ? Box({ flexDirection: 'column', rowGap: 1, children: [0, 2].map(r => Box({ key: 'jobs-' + r, flexDirection: 'row', columnGap: 1,
            children: JOBS.slice(r, r + 2).map((j, i) => tile('home-job-' + (r + i), j.label, j.hint, 'primary', () => runJob($, j.text))) })) })
        : Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1, rowGap: 0, children: JOBS.map((j, i) =>
            Button({ key: 'home-job-' + i, label: j.label, hotkey: String(i + 2), onPress: () => runJob($, j.text) })) }))
      const rows = CREW.map(c => ({ title: c.title + ' helper', what: c.what, waiting: crew[c.name].drafts.length > 0,
        badge: crew[c.name].running ? 'Working' : crew[c.name].drafts.length ? crew[c.name].drafts.length + ' waiting' : 'Caught up' }))
      if (desk) body.push(pic('Your crew', crewSvg(rows), 54 + rows.length * 46))
      body.push(desk
        ? Box({ flexDirection: 'row', columnGap: 1, children: [
            tile('home-crew', 'Open my crew', '', 'outline'),
            tile('home-codex', codex.busy ? 'Codex is checking…' : 'Check with Codex', '', 'outline'),
            tile('home-dash', 'Full dashboard', '', 'outline'),
          ] })
        : Box({ flexDirection: 'row', columnGap: 2, children: [
            Button({ key: 'home-crew', label: 'Open my crew', plain: true, onPress: () => { tab = 'crew'; redraw() } }),
            Button({ key: 'home-codex', label: codex.busy ? 'Codex is checking…' : 'Check with Codex', plain: true, onPress: () => codexButton($) }),
            Button({ key: 'home-dash', label: 'Full dashboard', plain: true, onPress: () => openDashboard($) }),
          ] }))
      if (desk) body.push(pic('Your BNSN apps', appsSvg(), 112))
      body.push(Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: [
        Link({ href: 'https://app.bnsn.ai', label: 'BNSN' }),
        Link({ href: 'https://bookbuilder.bnsn.ai', label: 'BookBuilder' }),
        Link({ href: 'https://improver.bnsn.ai', label: 'Improver' }),
        Link({ href: 'https://coursebuilder.bnsn.ai', label: 'CourseBuilder' }),
        Link({ href: 'https://community.bnsn.ai', label: 'AI Collective' }),
      ] }))
    }
    if (tab === 'do') {
      body.push(Text({ bold: true, children: ['What do you want to do?'] }))
      if (!project) {
        body.push(Button({ key: 'setup', label: 'Set me up (about 5 minutes)', hotkey: 's', autoFocus: true, onPress: () => startSetup($) }))
        body.push(Text({ dimColor: true, wrap: 'wrap', children: ['Tell your clone who you are, what you sell and how you sound. Everything below works better after this.'] }))
      }
      for (const d of DO) {
        body.push(Box({ flexDirection: 'column', children: [
          Button({ key: 'do-' + d.key, label: d.label, hotkey: d.hotkey, plain: true, onPress: () => { $.prompt.submit({ text: d.prompt, asUser: true }) } }),
          Text({ dimColor: true, wrap: 'truncate-end', children: ['   ' + d.hint] }),
        ] }))
      }
      body.push(Box({ flexDirection: 'column', children: [
        Button({ key: 'codex', label: codex.busy ? 'Codex is checking…' : 'Check with Codex', hotkey: '5', plain: true, onPress: () => codexButton($) }),
        Text({ dimColor: true, wrap: 'wrap', children: ['   ' + (codex.note || 'A second opinion on Claude\'s last piece of work, from your own Codex')] }),
      ] }))
      body.push(Text({ children: [' '] }))
      body.push(Input({ key: 'say', label: 'Or just say it', placeholder: 'Type what you want and press Enter', value: '', submitLabel: 'send',
        onSubmit: (value) => { if (String(value).trim()) $.prompt.submit({ text: String(value).trim(), asUser: true }) } }))
    }
    if (tab === 'crew') {
      body.push(Text({ dimColor: true, wrap: 'wrap', children: ['Your crew reads and drafts. The safety gate stops every post, send, purchase, refund, cancel and delete in code, so nothing goes out without you.'] }))
      for (const c of CREW) {
        const s = crew[c.name]
        const status = s.running ? 'working' : s.drafts.length ? s.drafts.length + (s.drafts.length === 1 ? ' draft waiting' : ' drafts waiting') : 'idle'
        body.push(Box({ flexDirection: 'column', borderStyle: 'round', paddingX: 1, children: [
          Box({ flexDirection: 'row', columnGap: 2, children: [Text({ bold: true, children: [c.title] }), Text({ dimColor: true, children: [status] })] }),
          Text({ wrap: 'wrap', children: [c.what] }),
          Text({ dimColor: true, wrap: 'wrap', children: ['Last run: ' + ago(s.lastRun, now) + (s.note ? ' · ' + s.note : '')] }),
          Box({ flexDirection: 'row', columnGap: 2, children: [
            Button({ key: 'run-' + c.name, label: s.running ? 'Working…' : 'Run now', onPress: async () => { $.ui.toast(await runCrew($, c.name)) } }),
            ...(s.drafts.length ? [Button({ key: 'review-' + c.name, label: 'Review drafts', onPress: () => {
              $.prompt.submit({ asUser: true, text: 'Show me the drafts in ' + crewDir(c.name) + '/drafts one at a time, newest first. For each one I will say send, edit or skip. Before anything goes out, show me exactly what goes where and wait for my yes. Move each finished draft into a "done" folder next to drafts.' })
            } })] : []),
          ] }),
          Select({ key: 'every-' + c.name, label: 'Runs', value: String(s.every || 0), options: SCHEDULES,
            onSelect: async (value) => { s.every = Number(value); await saveCrew($); redraw() } }),
        ] }))
      }
    }
    if (tab === 'voice') {
      body.push(Text({ wrap: 'wrap', children: ['Talk to your clone out loud and hear it answer. Voice is not in this version yet; it turns on here when it ships.'] }))
    }
    if (tab === 'skills') {
      body.push(Text({ bold: true, children: ['Your free skills'] }))
      for (const s of skills) body.push(Text({ wrap: 'wrap', children: ['/youcloned:' + s.name + (s.description ? '  ' + s.description : '')] }))
      body.push(Text({ children: [' '] }))
      body.push(Text({ bold: true, children: ['Jon Benson\'s skills'] }))
      if (skillKey) {
        body.push(Text({ wrap: 'wrap', children: ['SkillKey is connected. Jon\'s voice, VSL and conversion skills run from there.'] }))
        body.push(Button({ key: 'skillkey', label: 'Show my SkillKey skills', onPress: () => {
          $.prompt.submit({ asUser: true, text: 'List the skills I have in SkillKey and what each one does, in a short list.' })
        } }))
      } else {
        body.push(Text({ wrap: 'wrap', children: ['Jon\'s voice, VSL and conversion skills unlock with SkillKey. Once SkillKey is connected to your Claude app, they show up here.'] }))
      }
    }

    const top = tab === 'home' && e.surface === 'desktop' ? [tabs] : [header, tabs]
    return Box({ flexDirection: 'column', width, rowGap: 1, children: [...top, ...body] })
  })
}
