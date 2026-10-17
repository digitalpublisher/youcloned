// YouCloned: the customer's AI clone inside the Claude app.
// - /youcloned setup interviews the customer and saves their rules file (checked in code by save_setup).
// - Every conversation reads the rules file (prompt.context).
// - The YouCloned pane: Do, Crew, Voice and Skills tabs.
// - "Check with Codex" runs the customer's own Codex on Claude's work and puts the answer in the chat.
// - Crew templates (support drafter, inbox sorter) run as subagents behind a safety gate in code.
// - Jon's instructions (setup interview, crew) live on SkillKey and load when needed, never as files here.

import { judge, denyText } from './gate.js'
import { firstKey, writtenText, isEnvFile, commandReason, parseBans, bannedIn } from './guards.js'
import { RULES_NAME, checkSetup, rulesMarkdown } from './rules.js'
import { STEPS, CAN_SKIP, setupText, nextStep } from './steps.js'
import { HELPERS, parseAgent, gmailReads, helperJudge, helperDenyText } from './helpers.js'
import { UNIVERSAL_RULES } from './universal.js'
import { topSvg, heroSvg, moneySvg, cardHeadSvg, plateSvg, thumbSvg, PLATE, THUMB, setWidth } from './panel.js'

const PANE = 'youcloned'
const TABS = [['home', 'Dashboard'], ['skills', 'Skills'], ['crew', 'Crew'], ['money', 'Money'], ['setup', 'Setup']]
const CREW = [
  { name: 'support', title: 'Support', what: 'Drafts answers to customer questions in your voice' },
  { name: 'inbox', title: 'Inbox', what: 'Sorts your new email and drafts the replies that need you' },
]
const SCHEDULES = [{ value: '0', label: 'Only when I press Run' }, { value: '60', label: 'Every hour' }, { value: '240', label: 'Every 4 hours' }]

let interactive = true
let home = ''
let project = null          // the customer's YouCloned folder, once setup has saved
let tab = 'home'
let codex = { busy: false, note: '' }
let crew = {}               // name -> { running, lastRun, note, every, drafts }
const crewIds = new Map()   // agentId -> crew name
const notCrew = new Set()
const gatePassed = new Set() // tool_use_ids of crew calls the gate allowed
let skillKey = false        // the SkillKey connector is on in this session
let skillKeyServer = null   // its name for $.mcp.call: "claude.ai SkillKey" in the terminal, an id in the desktop app
const crewReady = new Set() // crew members registered with their instructions from SkillKey
const helperIds = new Map() // agentId -> feed-me helper name (librarian, wiki-writer)
const notHelper = new Set()
let sessionStartedAt = 0     // when this session began; connectors can take a minute to connect after it
const notOwned = new Set()  // YouCloned skills SkillKey says this account does not have (their plan decides)
let cloneHere = false       // this session runs in the customer's clone folder
let watched = false         // a person is looking at this session (terminal or desktop app)
let dashOn = false          // the dashboard and its timers are running for this session
let codexReady = false      // Codex is installed on this computer
let everywhere = false      // after setup, YouCloned shows in every session unless the owner turns it off
let live = { claudePct: null, claudeLabel: '', claudeSpan: '', words: null } // numbers the strip and dashboard show
let listening = false       // Isaac's voice conversation is running in this session
let version = ''            // this plugin's version, from its plugin.json, shown in the strip and told to Claude
let stopTalk = null         // ends the converse call that is running, when Talk is pressed again

const BLUE = '#3375d7'     // YouCloned blue
// SkillKey's install page: its "Copy SkillKey address" button opens Claude's Connectors with the steps.
const SKILLKEY_INSTALL = 'https://skills.bnsn.ai/gifts/install'
// The promo feed: Jon's newest item for the "New from Jon" card. It lives on our CDN, so Jon or Isaac
// change it by uploading one file, with no new add-on version. A copy is kept for offline use.
const FEED_URL = 'https://cdn.bnsn.ai/pdfs/youcloned/feed.json'
const CARD = '#161d29'     // the dashboard's navy card, its border, and the status colors
const CARD_LINE = '#283346'
const AMBER = '#e8b25c'
const BLUE_INK = '#8fb6f4'
// The BNSN apps on the Dashboard. Which ones the owner has is not looked up yet, so OWNED_SAMPLE stands in.
const APPS = [
  { key: 'skillkey', open: 'https://skills.bnsn.ai', get: SKILLKEY_INSTALL },
  { key: 'bnsn', open: 'https://app.bnsn.ai', get: 'https://bnsn.ai' },
  { key: 'bookbuilder', open: 'https://bookbuilder.bnsn.ai', get: 'https://bookbuilder.bnsn.ai' },
  { key: 'improver', open: 'https://improver.bnsn.ai', get: 'https://improver.bnsn.ai' },
  { key: 'coursebuilder', open: 'https://coursebuilder.bnsn.ai', get: 'https://coursebuilder.bnsn.ai' },
  { key: 'offerbuilder', soon: 'Opens Oct 14' },
  { key: 'aic', open: 'https://community.bnsn.ai', get: 'https://collective.bnsn.ai', join: true },
]
const OWNED_SAMPLE = ['bnsn', 'bookbuilder', 'improver']
const DASH_PORT = 4600
const DASH_URL = 'http://localhost:' + DASH_PORT
const SERVICE = 'ai.bnsn.youcloned.dashboard'
// Isaac's voice relay on this computer: a message sent to /say for this session is typed into it as
// "[Voice] ..." and Claude starts the voice conversation.
const RELAY = 'http://127.0.0.1:8771/say'
const SYNC_NOTE = 'Tell them one more thing in a short sentence or two: to get YouCloned updates on their own, open Customize, then Plugins, then + Add, then Manage marketplaces, click the three dots next to youcloned and switch on Sync automatically. The app can show it on when the marketplace is added and still leave it off.'
// Asked once during setup (Jon's yes, Oct 12, bnsnstack#88): newer Claude Code moved the bypass switch out of /config.
const NO_PROMPTS_QUESTION = 'Let your clone work without stopping to ask permission at every step?'
const NO_PROMPTS_NOTE = 'Before the first setup question, ask them this once, in these exact words: "' + NO_PROMPTS_QUESTION + '" '
  + 'Say in one short sentence what yes means: Claude stops asking before each file change or command on this computer, and they can switch it back in Claude\'s settings any time. '
  + 'Then call the work_without_prompts tool with allow true for yes or false for no, and go on with setup. Never ask it again.'
const DEVTOOLS_NOTE = 'Apple\'s developer tools box is waiting behind this window. Click its icon in the Dock (a blue box with a down arrow), then Install. It takes a few minutes and is free.'
const TALK = 'Talk to Isaac was pressed in YouCloned. Start a voice conversation now: call converse with a short hello and listen (listen_duration_min 8, listen_duration_max 600, so a short pause never ends their turn).'
const STOPPED = 'The owner pressed Talk again in YouCloned to stop the voice conversation. Do not call converse again until they press Talk. Carry on in text with anything already asked of you.'

// New project: Claude files this session in a sidebar group of its own (the add-on cannot reach the sidebar).
const NEW_PROJECT = { key: 'new-project', label: 'New project', text: 'Start a new project for this session. Ask me its name in one short question. Then, with the Claude app\'s sidebar tools, make a sidebar group with that name (or use the one that already has it), move this session into it, and set this session\'s title to the project name. Then ask what we\'re building first.' }
// Every skill YouCloned can start. SkillKey adds the ones the owner has bought. The owner pins the
// ones they use most; those show on the Dashboard and in the strip above Claude's message box.
const BUILT_IN = [
  { key: 'vsl-lead-writer', label: 'VSL lead', what: 'Your VSL lead, from Jon\'s VSL Lead Writer',
    text: 'Write my VSL lead with Jon\'s VSL Lead Writer skill. Ask me which offer first if I have more than one.' },
  { key: 'sales-page', label: 'Sales page', what: 'A sales page for one of your offers',
    text: 'Build a sales page for one of my offers with Jon\'s sales page skill. Ask me which offer first if I have more than one.' },
  { key: 'youtube-video', label: 'YouTube video', what: 'Topic, script in your voice, the edit and two thumbnails',
    text: 'Help me make my next YouTube video: topic, script in my voice, then the edit and two thumbnails.' },
  { key: 'inbox', label: 'Clear my inbox', what: 'Your inbox helper sorts your email and drafts the replies', text: '/youcloned crew inbox' },
  { key: 'sales-letter', label: 'Sales letter', what: 'For one of your offers, in your voice',
    text: 'Write a sales letter for one of my offers. If I sell more than one thing, ask me which one first. Follow my YouCloned rules for voice and brand, and save it as a file in my YouCloned folder.' },
  { key: 'email-series', label: 'Email series', what: 'Welcome, launch or promo',
    text: 'Write an email series for my business. Ask me first whether it is a welcome, launch or promo series and which offer it is for. Follow my YouCloned rules, and save it as a file in my YouCloned folder.' },
  { key: 'web-page', label: 'Web page', what: 'Your copy and your brand, one page',
    text: 'Build me a one-page website for my business as a single HTML file in my YouCloned folder. Use my YouCloned rules for the copy, colors and fonts, and show me how to open it when it is done.' },
  { key: 'offer', label: 'Plan an offer', what: 'Price, bonuses and guarantee',
    text: 'Help me plan a new offer for my audience: what it is, the price, the bonuses and the guarantee. Ask me a few questions first, then write the plan to a file in my YouCloned folder.' },
]
const DEFAULT_PINS = ['vsl-lead-writer', 'sales-page', 'youtube-video', 'inbox']
const MAX_PINS = 6
let skillKeySkills = []     // { key, label, what, text } for each skill SkillKey says this account owns
let pins = DEFAULT_PINS.slice()
let skillQuery = ''
let pressed = []            // jobs pressed in the panel or the strip, waiting for the job timer
let lastColumns = null      // the panel width the desktop app last reported, kept for tuning the drawings

function allSkills() {
  const keys = new Set(BUILT_IN.map(s => s.key))
  return [...BUILT_IN, ...skillKeySkills.filter(s => !keys.has(s.key))]
}

function pinnedSkills() {
  const all = allSkills()
  return pins.map(k => all.find(s => s.key === k)).filter(Boolean)
}

// SkillKey's list_skills answers one line per skill: - Name (skill: "slug"): what it does
function parseSkillList(text) {
  const out = []
  for (const line of String(text).split('\n')) {
    const m = /^-\s*(.+?)\s*\(skill:\s*"([^"]+)"\):\s*(.*)$/.exec(line.trim())
    if (!m || m[2].startsWith('youcloned-')) continue
    out.push({ key: m[2], label: m[1], what: m[3], text: 'Run my "' + m[1] + '" skill from SkillKey (start_skill with skill "' + m[2] + '").' })
  }
  return out
}

async function loadSkillKeySkills($) {
  try {
    const r = await skillKeyCall($, 'list_skills', {})
    skillKeySkills = parseSkillList((r.content || []).map(c => c.text || '').join('\n'))
    $.ui.invalidate('ui.render')
  } catch {}
}

async function togglePin($, key) {
  if (pins.includes(key)) pins = pins.filter(k => k !== key)
  else if (pins.length >= MAX_PINS) { $.ui.toast('Your Dashboard holds ' + MAX_PINS + ' skills. Unpin one first.'); return }
  else pins = [...pins, key]
  try { await $.store.set('pins', pins) } catch {}
  $.ui.invalidate('ui.render')
}
// Jon's newest video and the job it unlocks, shown on the Home tab until the feed has loaded once.
const NEW_FROM_JON = {
  watch: 'https://www.youtube.com/watch?v=j058ugnLtUE',
  title: 'How To Write The Story In A Video Sales Letter (VSL) With AI: Step 2 of 9',
  note: 'The skill that writes your story section is ready.',
  button: 'Write my story section',
  text: 'Write the story section of my VSL with Jon\'s VSL Story Writer skill.',
}
let promo = NEW_FROM_JON    // the feed's first item once loaded (or its saved copy)
let promoThumb = null       // its thumbnail as a data address, kept small for the panel
let deskSession = false     // this session runs in Claude's desktop app (the one the dashboard belongs to)

// Reads the feed (or, offline, the saved copy) and its thumbnail. Feed format:
// { "items": [ { "id", "title", "note", "button", "job", "watch", "thumb" } ] }, first item shown.
async function loadFeed($) {
  const file = dataDir() + '/feed.json'
  let text = null
  try { const r = await $.http.fetch(FEED_URL); if (r && r.ok) text = r.text } catch {}
  let feed = null
  try { if (text) { feed = JSON.parse(text); await $.fs.write(file, text) } } catch { feed = null }
  if (!feed) { try { if (await $.fs.exists(file)) feed = JSON.parse(await $.fs.read(file)) } catch {} }
  const item = feed && Array.isArray(feed.items) ? feed.items.find(i => i && i.title && i.job) : null
  if (!item) return
  const id = String(item.id || 'item').replace(/[^a-z0-9-]/gi, '')
  promo = { id, title: String(item.title), note: String(item.note || ''), button: String(item.button || 'Start'), text: String(item.job), watch: /^https:\/\//.test(item.watch || '') ? item.watch : null }
  const thumb = dataDir() + '/feed-' + id + '.jpg'
  if (/^https:\/\//.test(item.thumb || '') && !(await $.fs.exists(thumb))) await run($, ['/usr/bin/curl', '-sfL', '--max-time', '20', '-o', thumb, item.thumb])
  const b64 = ((await run($, ['/usr/bin/base64', '-i', thumb])).stdout || '').replace(/\s+/g, '')
  // The panel's pictures share a size budget; a feed thumbnail over ~24k characters is left out.
  promoThumb = b64 && b64.length < 24000 ? 'data:image/jpeg;base64,' + b64 : null
  try { await $.fs.write(dataDir() + '/feed-thumb.txt', thumb) } catch {}
  $.ui.invalidate('ui.render')
}

// Codex's own usage record: the last rate-limit line in its newest session log.
async function readCodexPlan($) {
  const r = await run($, ['/bin/sh', '-c', 'f=$(ls -t "' + home + '"/.codex/sessions/*/*/*/*.jsonl 2>/dev/null | head -1); [ -n "$f" ] && tail -c 3000000 "$f" | grep \'"rate_limits"\' | tail -1'])
  const find = (o) => { if (!o || typeof o !== 'object') return null; if (o.rate_limits) return o.rate_limits; for (const v of Object.values(o)) { const x = find(v); if (x) return x } return null }
  try {
    const p = (find(JSON.parse(r.stdout)) || {}).primary
    if (!p || typeof p.used_percent !== 'number') return
    const d = p.resets_at ? new Date(p.resets_at * 1000) : null
    const span = p.window_minutes >= 10080 ? 'this week' : p.window_minutes ? 'this ' + Math.round(p.window_minutes / 60) + ' hours' : ''
    live.codex = { left: Math.max(0, 100 - p.used_percent),
      label: 'Codex' + (d ? ' · resets ' + d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : span ? ' · ' + span : '') }
  } catch {}
}

// Made or saved this week. Sample figures, labelled Sample, until the owner's Stripe and job hours are wired.
const MONEY_SAMPLE = { total: 7514, up: 17, sample: true, parts: [
  { label: 'Sales', value: 4120, color: '#5a92ea' }, { label: 'Time', value: 3180, color: '#a598f5' }, { label: 'Bills', value: 214, color: '#e8b25c' },
] }

function dataDir() {
  return home + '/.youcloned'
}

// Runs a job from the strip or the dashboard: YouCloned commands run here, anything else goes to the chat as the owner's words.
async function runJob($, text) {
  const t = String(text || '').trim()
  if (!t) return
  const m = /^\/youcloned\s*(.*)$/i.exec(t)
  if (!m) { await $.prompt.submit({ text: t, asUser: true }); return }
  const args = m[1].trim()
  const word = args.split(/\s+/)[0].toLowerCase()
  if (word === 'setup') return startSetup($)
  if (word === 'codex') return codexButton($)
  if (word === 'crew') { $.ui.toast(await crewNow($, (args.split(/\s+/)[1] || '').toLowerCase())); return }
}

// Going through a helper's drafts with the owner, one at a time; nothing goes out without their yes.
function reviewJob(c) {
  return { label: 'Review ' + c.title + ' drafts', text: 'Show me the drafts in ' + crewDir(c.name) + '/drafts one at a time, newest first. For each one I will say send, edit or skip. Before anything goes out, show me exactly what goes where and wait for my yes. Move each finished draft into a "done" folder next to drafts.' }
}

// A press in the panel or the strip queues its job and says so; the job timer sends it to the chat,
// the same way the dashboard's jobs go out. Every send and failure lands in ~/.youcloned/press.log.
function pressJob($, job) {
  pressed.push(job)
  try { $.ui.toast('Starting ' + job.label + '…') } catch {}
  if (!dashOn) $.clock.after(0, () => sendPressed($))
}

async function sendPressed($) {
  while (pressed.length) {
    const job = pressed.shift()
    try { await runJob($, job.text); await logPress($, 'sent: ' + job.label) }
    catch (err) { await logPress($, 'failed: ' + job.label + ': ' + String((err && err.message) || err).slice(0, 300)) }
  }
}

async function logPress($, line) {
  try {
    const file = dataDir() + '/press.log'
    const old = (await $.fs.exists(file)) ? await $.fs.read(file) : ''
    await $.fs.write(file, (old + new Date(await $.clock.now()).toISOString() + ' ' + line + '\n').slice(-20000))
  } catch {}
}

// Reads jobs the dashboard queued and starts them.
async function drainJobs($) {
  await sendPressed($)
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
    // The tightest window is the one that stops the owner, so the gauge shows it: the weekly limit
    // can be nearly spent while the 5-hour one is fresh.
    const w = (u.rateLimits || []).reduce((a, r) => (!a || r.percentUsed > a.percentUsed ? r : a), null)
    if (w) {
      live.claudePct = w.percentUsed
      // The plan warning from the 49 jobs list (night one): once per reset window, at 90% used.
      try {
        const key = String(w.kind) + ':' + String(w.resetsAt || '')
        if (w.percentUsed >= 90 && (await $.store.get('planWarned')) !== key) {
          await $.store.set('planWarned', key)
          $.ui.toast('Your Claude plan is ' + Math.round(w.percentUsed) + '% used. Finish big jobs first, and start fresh chats to make it last.')
        }
      } catch {}
      const span = w.kind === 'seven_day' ? 'this week' : w.kind === 'five_hour' ? 'this 5 hours' : 'spend limit'
      let label = 'Claude plan · ' + span
      if (w.resetsAt) {
        const d = new Date(w.resetsAt)
        const day = w.kind === 'seven_day' ? d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' : ''
        label = 'Claude plan · ' + span + ' · resets ' + day + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      }
      live.claudeLabel = label
      live.claudeSpan = w.kind === 'seven_day' ? 'Weekly plan' : w.kind === 'five_hour' ? '5-hour plan' : 'Claude plan'
      // A failed read keeps the last numbers; claudeAt lets the dashboard say how old they are (fixes.json bridge-12).
      live.claudeAt = await $.clock.now()
    }
  } catch {}
  if (withWords) {
    try {
      const r = await skillKeyCall($, 'word_balance', {})
      const txt = (r.content || []).map(c => c.text || '').join(' ')
      // Only the number SkillKey labels "Words left"; any other number (a top-up address) is not a balance.
      const m = /words left:\s*([\d,]+)/i.exec(txt)
      live.words = m ? Number(m[1].replace(/,/g, '')) : null
    } catch {} // In Auto mode SkillKey answers only inside a request; the last balance stands.
    await readCodexPlan($)
  }
  if (withWords || !live.setup) { try { await checkSetupSteps($) } catch {} }
  try {
    const name = project ? ((await readRules($)) || '').match(/^#+\s*Who I am\s*\n+([^\n]+)/m) : null
    lastName = name ? name[1].trim().split(/[ ,]/)[0] : undefined
    await writeState($)
  } catch {}
  $.ui.invalidate('ui.render')
}

let lastName
// Night-one setup (hooks/steps.js): each step is checked on this computer, never assumed, and the
// dashboard and setup_next both read the result.
//   tools      install-tools --check passes (Git, Node, Python, ffmpeg, Obsidian, gh)
//   home       the clone folder setup_next saved (its marker file) or the one the interview saved
//   protection the YouCloned key check is in Git's hooks for every repository
//   skillkey   SkillKey's tools are in this Claude account
//   interview  the rules file is saved in the clone folder
//   skills     every skill in skills-pack.txt is in ~/.claude/skills with its SKILL.md
//   backup     the folder is a Git repository with a GitHub remote, and setup-backup proved it private
//   library    the env file holds the library's address and token
//   voice      VoiceMode's settings file is there (the voice setup writes it last)
//   feed       the librarian wrote the library's index page in the clone folder
async function cloneFolder($) {
  const saved = await $.store.get('folder')
  return typeof saved === 'string' && saved ? saved : project
}

const sep = () => (onMac() ? '/' : '\\')

// Normal chats search the owner's library too, not only the helpers (Oct 17): before answering about the owner's
// business, offers, customers or past work, look it up there. The command never shows the token.
let pluginRoot = ''
function LIBRARY_NOTE() {
  if (!pluginRoot) return ''
  const py = onMac() ? 'python3' : 'py -3'
  return '\n\n## Your library\n\nWhen the owner asks about their business, offers, customers, past emails, pages, books, courses or videos, search their library first and answer from what it finds, naming the source: ' +
    py + ' "' + pluginRoot + (onMac() ? '/library/feed.py' : '\\library\\feed.py') + '" search "<their question in a few words>". If the library isn\'t set up yet, say so and offer the setup step.' +
    ' When they ask what you have collected or what is in their library, run the same command with stats instead of search and tell them the counts by kind in plain words.' +
    ' When they ask when their backup last saved, read the last lines of ' + (onMac() ? home + '/.youcloned/backup.log' : home + '\\.youcloned\\backup.log') + ' and tell them the date and time of the last "backed up" line, or that it hasn\'t run yet.'
}


// Claude Code's user settings file, where bypass permission mode is switched on.
const settingsFile = () => home + '/.claude/settings.json'

// The Claude Code panel in Cursor (and VS Code) ignores bypass mode in ~/.claude/settings.json unless the editor's
// own user settings allow it (bnsnstack#268): claudeCode.allowDangerouslySkipPermissions + initialPermissionMode.
const EDITOR_KEYS = { 'claudeCode.allowDangerouslySkipPermissions': true, 'claudeCode.initialPermissionMode': 'bypassPermissions' }

// The user settings file of each editor installed on this computer (its User folder exists).
async function editorFiles($) {
  let base = home + '/.config'
  if (onMac()) base = home + '/Library/Application Support'
  else if (/^[A-Za-z]:/.test(home)) base = (await $.env.get('APPDATA')) || home + '/AppData/Roaming'
  const out = []
  for (const app of ['Cursor', 'Code']) { if (await $.fs.exists(base + '/' + app + '/User')) out.push(base + '/' + app + '/User/settings.json') }
  return out
}

async function noPromptsOn($) {
  try {
    if (JSON.parse(await $.fs.read(settingsFile()))?.permissions?.defaultMode !== 'bypassPermissions') return false
    for (const f of await editorFiles($)) { if (JSON.parse(await $.fs.read(f))?.['claudeCode.allowDangerouslySkipPermissions'] !== true) return false }
    return true
  } catch { return false }
}

// Merges keys into one JSON settings file, backing it up first. False when the file isn't plain JSON
// (an editor file with comments, say): that file is left alone.
async function mergeSettings($, file, merge) {
  let before = null
  let settings = {}
  if (await $.fs.exists(file)) {
    before = await $.fs.read(file)
    try { settings = before.trim() ? JSON.parse(before) : {} } catch { settings = null }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false
    const stamp = new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-')
    await $.fs.write(file + '.youcloned-backup-' + stamp, before)
  }
  merge(settings)
  await $.fs.write(file, JSON.stringify(settings, null, 2) + '\n')
  return before !== null ? 'backup' : 'new'
}

// The buyer's answer to the one setup question. Yes merges two keys into their settings file and keeps
// everything else; the file is backed up first. A file that isn't valid JSON is left alone.
async function setNoPrompts($, allow) {
  if (!allow) {
    await $.store.set('noPromptsAsked', 'no')
    return 'Left as it is: Claude keeps asking before each step. If they change their mind later, they can say so and you call work_without_prompts with allow true.'
  }
  const file = settingsFile()
  const done = await mergeSettings($, file, settings => {
    settings.permissions = { ...(settings.permissions && typeof settings.permissions === 'object' ? settings.permissions : {}), defaultMode: 'bypassPermissions' }
    settings.skipDangerousModePermissionPrompt = true
  })
  if (!done) {
    return 'Nothing changed: their Claude settings file (' + file + ') isn\'t in a form YouCloned can safely edit. Tell them in one sentence, and that they can turn it on themselves later in Claude\'s settings.'
  }
  let backup = done === 'backup'
  const skipped = []
  for (const f of await editorFiles($)) {
    const ed = await mergeSettings($, f, settings => Object.assign(settings, EDITOR_KEYS))
    if (!ed) skipped.push(f)
    else if (ed === 'backup') backup = true
  }
  await $.store.set('noPromptsAsked', 'yes')
  return 'Done: their clone now works without stopping to ask permission, starting with their next new chat. Tell them that in one sentence' + (backup ? ' (their old settings are saved next to the file as a backup)' : '') + ', then go on with setup.'
    + (skipped.length ? ' One more short sentence for them: their editor settings file (' + skipped.join(', ') + ') has notes in it YouCloned won\'t touch, so for the Claude panel in Cursor they open Cursor\'s settings, search "Claude Code", tick "Allow Dangerously Skip Permissions" and set "Initial Permission Mode" to bypassPermissions.' : '')
}
// The dashboard's "Set up your clone" steps 1 to 3, from what is on this computer, never assumed:
// home = the rules file is saved; tools = git (Apple's developer tools or Homebrew), Obsidian, Node,
// ffmpeg and Wispr Flow are all there; backup = the clone folder is a git repo with a GitHub remote.
async function checkSetupSteps($) {
  const has = async (paths) => { for (const p of paths) { if (await $.fs.exists(p)) return true } return false }
  const folder = await cloneFolder($)
  const root = $.plugin.root
  const st = {}
  // tools
  if (onMac()) {
    if (await $.fs.exists(root + '/setup/install-tools.sh')) {
      st.tools = (await runWith($, ['/bin/bash', root + '/setup/install-tools.sh', '--check'], { timeoutMs: 60000 })).exitCode === 0
    } else {
      const git = (await run($, ['/usr/bin/xcode-select', '-p'])).exitCode === 0 || (await has(['/opt/homebrew/bin/git', '/usr/local/bin/git']))
      st.tools = git && (await has(['/Applications/Obsidian.app', home + '/Applications/Obsidian.app']))
        && (await has(['/opt/homebrew/bin/node', '/usr/local/bin/node', home + '/.nvm/versions/node']))
        && (await has(['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']))
    }
  } else {
    st.tools = (await runWith($, ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', root + '\\setup\\install-tools.ps1', '-Check'], { timeoutMs: 60000 })).exitCode === 0
  }
  st.home = !!folder && ((await $.fs.exists(folder + '/.youcloned-folder')) || (await $.fs.exists(folder + '/' + RULES_NAME)))
  st.protection = (await $.fs.exists(home + '/.youcloned/git-hooks/pre-commit')) && (await $.fs.exists(home + '/.youcloned/lib/secret-rules.mjs'))
  if (st.protection) {
    // --verify plants a fake key in a scratch repository and passes only when the commit is refused.
    const script = root + (onMac() ? '/setup/guards/install-git-hooks.mjs' : '\\setup\\guards\\install-git-hooks.mjs')
    const r = onMac() ? await runWith($, ['/bin/bash', '-lc', 'node "$0" --verify', script], { timeoutMs: 60000 })
      : await runWith($, ['node', script, '--verify'], { timeoutMs: 60000 })
    st.protection = r.exitCode === 0
  }
  if (!skillKeyServer) { try { await checkSkillKey($) } catch {} }
  st.skillkey = !!skillKeyServer
  st.interview = !!folder && (await $.fs.exists(folder + '/' + RULES_NAME))
  st.skills = false
  try {
    const names = (await $.fs.read(root + '/skills-pack.txt')).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    st.skills = names.length > 0
    for (const n of names) { if (!(await $.fs.exists(home + '/.claude/skills/' + n + '/SKILL.md'))) { st.skills = false; break } }
    if (await $.fs.exists(home + '/.claude/skills/youcloned-setup/SKILL.md')) st.skills = false // the old setup skill, retired by install-skills
  } catch {}
  st.backup = false
  if (folder) {
    try {
      st.backup = /\[remote "[^"]+"\][^[]*url\s*=\s*\S*github\.com/i.test(await $.fs.read(folder + '/.git/config'))
        && (await $.fs.exists(folder + '/.git/youcloned-backup-private'))
    } catch {}
  }
  st.library = false
  if (folder) {
    try {
      const env = await $.fs.read(folder + '/.env')
      st.library = /^YOUCLONED_LIBRARY_URL=\S+/m.test(env) && /^YOUCLONED_LIBRARY_TOKEN=\S+/m.test(env)
        && (await $.fs.exists(dataDir() + '/library-ok')) // written by library/smoke-test.py when add, find and remove all passed
    } catch {}
  }
  st.voice = (await $.fs.exists(home + '/.voicemode/voicemode.env'))
    && (await has([home + '/.local/bin/voicemode', home + '/.local/bin/voicemode.exe', home + '/AppData/Roaming/uv/tools/voice-mode']))
  st.feed = !!folder && (await $.fs.exists(folder + '/Library/index.md')) && (await $.fs.exists(folder + '/Library/.fed.json'))
  let skipped = []
  try { const s = await $.store.get('skipped'); if (Array.isArray(s)) skipped = s.filter(x => CAN_SKIP.has(x)) } catch {}
  const next = nextStep(st, new Set(skipped))
  live.setup = {
    home: st.home, tools: st.tools, backup: st.backup, // read by older dashboards
    steps: STEPS.map(s => ({ id: s.id, title: s.title, why: s.why, done: !!st[s.id], skipped: !st[s.id] && skipped.includes(s.id) })),
    next: next ? next.id : null,
  }
  return { st, skipped: new Set(skipped), folder }
}

async function setupNext($, e) {
  if (e && e.folder) {
    const f = expandHome(e.folder).replace(/[\\/]+$/, '')
    if (!/^([A-Za-z]:)?[\\/]/.test(f)) return 'Not saved: the folder must be a full path, such as ' + nightFolder() + '.'
    try { await $.fs.write(f + '/.youcloned-folder', 'This folder is a YouCloned clone home.\n') } catch (err) { return 'Could not make ' + f + ': ' + String(err).slice(0, 200) }
    await $.store.set('folder', f)
    // The starter skills and the library scripts find the clone folder here (first line, full path).
    try { await $.fs.write(dataDir() + '/vault-path', f + '\n') } catch (err) { return 'Saved the folder, but could not record it for the skills (' + String(err).slice(0, 160) + '). Tell the person in one sentence, then call setup_next with the same folder again.' }
  }
  if (e && e.resume) await $.store.set('skipped', []) // "finish my setup": the steps they put off come back
  if (e && e.skip) {
    if (!CAN_SKIP.has(e.skip)) return 'The ' + e.skip + ' step can\'t be put off: every step after it needs it.'
    let s = []
    try { const v = await $.store.get('skipped'); if (Array.isArray(v)) s = v } catch {}
    if (!s.includes(e.skip)) s.push(e.skip)
    await $.store.set('skipped', s)
  }
  const { st, skipped, folder } = await checkSetupSteps($)
  await writeState($)
  $.ui.invalidate('ui.render')
  const f = folder || nightFolder()
  const next = nextStep(st, skipped)
  if (next && next.id === 'feed') { try { await registerHelpers($) } catch (err) { $.ui.log('feed-me helpers not registered: ' + String(err).slice(0, 200)) } }
  return setupText(st, skipped, {
    root: $.plugin.root, home, folder: f, mac: onMac(), defaultFolder: nightFolder(),
    needsSkillKey: NEEDS_SKILLKEY, envFile: f + sep() + '.env', scratch: home + sep() + '.youcloned' + sep() + 'feeding',
    python: next && next.id === 'feed' && onMac() ? await findPython($) : '',
  })
}

// The night-one default: the same Obsidian Vault folder Jon's clone uses, so the skills pack, the
// lessons and the env file all agree on one place.
function nightFolder() {
  return home + (onMac() ? '/Documents/Obsidian Vault' : '\\Documents\\Obsidian Vault')
}

// What the dashboard reads: the numbers, the owner's name, this session (for the talk button) and
// whether Isaac is in a voice conversation (for the glow).
// Every YouCloned chat writes the numbers, but only a session in Claude's desktop app names itself as
// the one the dashboard's talk button reaches (the dashboard lives in that app's browser pane).
async function writeState($) {
  try {
    let mine = { session: await $.session.id(), listening }
    if (!deskSession) {
      try { const old = JSON.parse(await $.fs.read(dataDir() + '/state.json')); mine = { session: old.session, listening: !!old.listening } } catch { mine = {} }
    }
    await $.fs.write(dataDir() + '/state.json', JSON.stringify({ ...live, name: lastName, ...mine, at: await $.clock.now() }))
  } catch {}
}

// Talk is a toggle: a press while Isaac listens stops him, otherwise it starts him.
async function pressTalk($) {
  if (listening && stopTalk) { stopTalk(); $.ui.toast('Isaac stopped'); return }
  await startTalk($)
}

// Asks the voice relay to start Isaac's voice conversation in this session.
async function startTalk($) {
  try {
    const r = await $.http.fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: await $.session.id(), text: TALK }) })
    if (!r.ok) throw new Error('relay answered ' + r.status)
    $.ui.toast('Isaac is listening')
  } catch { $.ui.toast('Isaac\'s voice isn\'t running on this computer') }
}

async function dashboardUp($) {
  try { const r = await $.http.fetch(DASH_URL + '/state.json'); return r && r.status === 200 } catch { return false }
}

// Finds Python: the desktop app gives add-ons a short program path, so known places are checked first.
// Apple's /usr/bin/python3 is only a stand-in that asks to install the developer tools, so it counts
// only when they are installed. A Mac with none of these gets YouCloned's own Python (ownPython).
async function findPython($) {
  for (const p of ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/Library/Frameworks/Python.framework/Versions/Current/bin/python3']) {
    if (await $.fs.exists(p)) return p
  }
  if (!onMac()) return 'python3'
  if ((await $.fs.exists('/usr/bin/python3')) && (await run($, ['/usr/bin/xcode-select', '-p'])).exitCode === 0) return '/usr/bin/python3'
  return ownPython($)
}

// YouCloned's own Python on a fresh Mac: a pinned uv, checked against its published checksum, fetches
// a standalone Python into ~/.youcloned/python. Nothing else on the Mac changes and no password is asked.
const UV_VERSION = '0.12.15'
const UV_SHA256 = {
  'aarch64-apple-darwin': 'dc304b9ed1b24174572290fba60ac3f6fe63c73a671f0439e62a91375841964d',
  'x86_64-apple-darwin': 'e9ca61775532368fe518ab03e7a354c7ecab8ccb3c7d941c775fcc4a362b801b',
}
const OWN_PYTHON = '3.12'
let fetchingPython = null

function uvEnv() {
  return { HOME: home, PATH: '/usr/bin:/bin', UV_PYTHON_INSTALL_DIR: dataDir() + '/python', UV_NO_MODIFY_PATH: '1' }
}

async function ownPython($) {
  const uv = dataDir() + '/bin/uv'
  const find = async () => {
    if (!(await $.fs.exists(uv))) return null
    const r = await runWith($, [uv, 'python', 'find', '--no-project', OWN_PYTHON], { env: uvEnv() })
    return r.exitCode === 0 && r.stdout.trim() ? r.stdout.trim() : null
  }
  const found = await find()
  if (found) return found
  if (!fetchingPython) fetchingPython = fetchOwnPython($, uv).finally(() => { fetchingPython = null })
  return (await fetchingPython) ? find() : null
}

async function fetchOwnPython($, uv) {
  const machine = ((await run($, ['/usr/bin/uname', '-m'])).stdout || '').trim()
  const target = machine === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  const work = dataDir() + '/uv-download'
  const archive = work + '/uv.tar.gz'
  await run($, ['/bin/rm', '-rf', work])
  await run($, ['/bin/mkdir', '-p', work, dataDir() + '/bin'])
  try {
    const url = 'https://github.com/astral-sh/uv/releases/download/' + UV_VERSION + '/uv-' + target + '.tar.gz'
    if ((await runWith($, ['/usr/bin/curl', '-fsSL', '-o', archive, url], { timeoutMs: 180000 })).exitCode !== 0) return false
    const sum = ((await run($, ['/usr/bin/shasum', '-a', '256', archive])).stdout || '').split(/\s+/)[0]
    if (sum !== UV_SHA256[target]) { $.ui.log('uv download did not match its checksum'); return false }
    if ((await run($, ['/usr/bin/tar', '-xzf', archive, '-C', work])).exitCode !== 0) return false
    if ((await run($, ['/bin/cp', work + '/uv-' + target + '/uv', uv])).exitCode !== 0) return false
    const r = await runWith($, [uv, 'python', 'install', '--no-bin', OWN_PYTHON], { env: uvEnv(), timeoutMs: 600000 })
    if (r.exitCode !== 0) $.ui.log('Python install did not finish: ' + r.stderr.slice(0, 300))
    return r.exitCode === 0
  } finally {
    await run($, ['/bin/rm', '-rf', work])
  }
}

// Git counts only when it is installed: on a Mac with no developer tools /usr/bin/git is a
// stand-in that pops an install box.
async function gitPath($) {
  for (const p of ['/opt/homebrew/bin/git', '/usr/local/bin/git']) if (await $.fs.exists(p)) return p
  if (onMac() && (await run($, ['/usr/bin/xcode-select', '-p'])).exitCode !== 0) return null
  return (await $.fs.exists('/usr/bin/git')) ? '/usr/bin/git' : 'git'
}

// A key may go in an env file only when git ignores it (or there is no repository to leak it from).
async function envFileAllowed($, file) {
  const git = await gitPath($)
  if (!git) return true
  const dir = file.replace(/[\\/][^\\/]*$/, '') || '/'
  const r = await runWith($, [git, 'check-ignore', '-q', '--', file], { cwd: dir })
  return r.exitCode === 0 || r.exitCode === 128
}

async function loadBans($) {
  const file = dataDir() + '/bans.json'
  try { return (await $.fs.exists(file)) ? parseBans(await $.fs.read(file)) : null } catch { return null }
}

// On a Mac the dashboard runs as a background service, so it is already up when the person clicks
// Claude's globe, and launch.json names its address (no play button, nothing to start). Elsewhere
// Claude starts it from launch.json and the add-on starts it too.
const onMac = () => home.startsWith('/Users/')

async function run($, argv) {
  try { return await $.process.run(argv) } catch (err) { return { exitCode: 1, stdout: '', stderr: String(err) } }
}

async function runWith($, argv, init) {
  try { return await $.process.run(argv, init) } catch (err) { return { exitCode: 1, stdout: '', stderr: String(err) } }
}

function servicePlist(python, server) {
  const x = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0"><dict>\n<key>Label</key><string>' + SERVICE + '</string>\n' +
    '<key>ProgramArguments</key><array><string>' + x(python) + '</string><string>' + x(server) + '</string><string>' + DASH_PORT + '</string></array>\n' +
    '<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n' +
    '<key>StandardErrorPath</key><string>' + x(dataDir() + '/dashboard.log') + '</string>\n</dict></plist>\n'
}

// Copies this version's dashboard to ~/.youcloned/dashboard and (re)loads the background service when
// either changed. Returns false when the service could not be set up.
async function ensureService($) {
  const dst = dataDir() + '/dashboard'
  const plist = home + '/Library/LaunchAgents/' + SERVICE + '.plist'
  const python = await findPython($)
  if (!python) return false
  const want = servicePlist(python, dst + '/server.py')
  let from = '', have = ''
  try { if (await $.fs.exists(dst + '/.from')) from = (await $.fs.read(dst + '/.from')).trim() } catch {}
  try { if (await $.fs.exists(plist)) have = await $.fs.read(plist) } catch {}
  if (from === $.plugin.root && have === want && (await dashboardUp($))) return true
  await run($, ['/bin/rm', '-rf', dst])
  await run($, ['/bin/mkdir', '-p', dataDir(), home + '/Library/LaunchAgents'])
  if ((await run($, ['/bin/cp', '-R', $.plugin.root + '/dashboard', dst])).exitCode !== 0) return false
  try { await $.fs.write(dst + '/.from', $.plugin.root + '\n'); await $.fs.write(plist, want) } catch { return false }
  const uid = ((await run($, ['/usr/bin/id', '-u'])).stdout || '').trim()
  if (!uid) return false
  await run($, ['/bin/launchctl', 'bootout', 'gui/' + uid + '/' + SERVICE])
  return (await run($, ['/bin/launchctl', 'bootstrap', 'gui/' + uid, plist])).exitCode === 0
}

// Names the dashboard in the clone folder's .claude/launch.json, the list Claude's browser shows.
async function writeLaunch($, cwd, entry) {
  const launch = cwd + '/.claude/launch.json'
  let conf = { version: '0.0.1', configurations: [] }
  try { if (await $.fs.exists(launch)) conf = JSON.parse(await $.fs.read(launch)) } catch { conf = null }
  if (!conf) return
  conf.configurations = (conf.configurations || []).filter(c => c.name !== 'YouCloned')
  conf.configurations.push(entry)
  try { await $.fs.write(launch, JSON.stringify(conf, null, 2) + '\n') } catch {}
}

async function startDashboard($, cwd) {
  if (onMac() && (await ensureService($))) {
    await writeLaunch($, cwd, { name: 'YouCloned', url: DASH_URL })
    return
  }
  const python = await findPython($)
  if (!python) { $.ui.log('dashboard did not start: no Python on this computer'); return }
  const server = $.plugin.root + '/dashboard/server.py'
  await writeLaunch($, cwd, { name: 'YouCloned', runtimeExecutable: python, runtimeArgs: [server, String(DASH_PORT)], port: DASH_PORT, autoPort: false })
  if (!(await dashboardUp($))) {
    try { const r = $.process.spawn([python, server, String(DASH_PORT)]); if (r && typeof r.catch === 'function') r.catch(() => {}) } catch (err) { $.ui.log('dashboard did not start: ' + String(err)) }
  }
}

// Starts the dashboard and the timers that feed it, once per session.
async function turnOn($, cwd) {
  if (dashOn) return
  dashOn = true
  await startDashboard($, cwd || (await openedFolder($)))
  $.clock.every(1500, () => drainJobs($))
  $.clock.every(20000, () => refreshLive($, false))
  $.clock.every(300000, () => refreshLive($, true))
  $.clock.after(500, () => loadFeed($))
  $.clock.every(1800000, () => loadFeed($))
  $.clock.after(2000, () => refreshLive($, true))
  // The full dashboard waits in Claude's browser pane, ready for the globe button.
  $.clock.after(1500, () => showDashboard($))
  try { codexReady = !!(await findCodex($)) } catch {}
}

// Loads the full dashboard into Claude's browser pane with the desktop app's own browser tools: start the
// dashboard (launch.json "YouCloned") and open the pane on its address. The app keeps that pane out of view
// until the person presses its globe button, so the strip tells them where it is. Without the browser tools
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
  if (started === null) { tab = 'home'; await openPane($, false); return false }
  await browserCall($, 'preview_start', { url: DASH_URL + '/' })
  return true
}

// Opens the YouCloned panel, or closes it when it is already open.
async function togglePane($) {
  let open = false
  try { open = (await $.ui.panes()).some(p => (p.id || p) === PANE) } catch {}
  if (open) { try { await $.ui.close({ id: PANE }) } catch { try { await $.ui.close(PANE) } catch {} } return }
  await openPane($, true)
}

function openDashboard($) {
  $.prompt.submit({ text: 'Open the YouCloned dashboard in the Browser pane: start the "YouCloned" preview from .claude/launch.json (it starts its own server on port ' + DASH_PORT + '), then show it. No other work.' })
}

function crewDir(name) {
  return project ? project + '/crew/' + name : null
}

// Apple's "install the developer tools" box (Claude Code runs git, which asks for them on a new Mac) opens
// behind the Claude window and shows only as a Dock icon, so a buyer can wait on it without knowing.
// While that installer is open, say where it is, once per session.
async function nudgeDevTools($) {
  try {
    const r = await run($, ['/usr/bin/pgrep', '-f', 'Install Command Line Developer Tools'])
    if (r.exitCode !== 0) return
    $.ui.toast(DEVTOOLS_NOTE)
    $.ui.log(DEVTOOLS_NOTE)
  } catch {}
}

// Setup's default folder: the one this conversation is open in, so YouCloned is on where the buyer
// already works. A session in the home folder itself, or with no folder, falls back to ~/YouCloned.
async function defaultFolder($) {
  const cwd = (await openedFolder($)).replace(/[\\/]+$/, '')
  return cwd && cwd !== home && /^([A-Za-z]:)?[\\/]./.test(cwd) ? cwd : home + '/YouCloned'
}

// The folder the buyer opened this conversation in. A shell cd inside the chat (Claude reading writing
// samples in a subfolder, say) moves $.session.cwd() but not the session's root, so setup's default
// folder and the dashboard's launch.json follow the root. Engines without root fall back to cwd.
async function openedFolder($) {
  try { const r = await $.session.root(); if (r) return String(r) } catch {}
  try { return String((await $.session.cwd()) || '') } catch { return '' }
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
  // In the desktop app a connector's tools wait behind ToolSearch and $.tool.list() leaves them
  // out; the context breakdown lists every connector tool, loaded or not, with its server.
  if (!skillKeyServer) {
    try {
      const rows = (await $.session.usage({ breakdown: 'summary' }))?.context?.breakdown?.mcpTools || []
      const found = skillKeyFrom(rows.map(t => t.name))
      const row = found && rows.find(t => t.name === 'mcp__' + found + '__start_skill')
      if (row) { skillKeyServer = row.serverName || found; await $.store.set('skillKeyServer', skillKeyServer) }
    } catch {}
  }
  if (!skillKeyServer) { const saved = await $.store.get('skillKeyServer'); if (typeof saved === 'string' && saved) skillKeyServer = saved }
  skillKey = !!skillKeyServer
}

async function skillKeyCall($, tool, args) {
  const names = skillKeyServer ? [skillKeyServer] : ['claude.ai SkillKey']
  if (skillKeyServer && skillKeyServer !== 'claude.ai SkillKey') names.push('claude.ai SkillKey')
  const text = (x) => x ? String(x.message || (Array.isArray(x.content) ? x.content.map(c => c.text || '').join(' ') : '') || x) : ''
  const reasons = []
  let listed = false
  for (const server of names) {
    try {
      const r = await $.mcp.call(server, tool, args)
      if (r && !r.isError) {
        if (server !== skillKeyServer) { skillKeyServer = server; skillKey = true; await $.store.set('skillKeyServer', server) }
        return r
      }
      reasons.push(server + ': ' + text(r))
    } catch (err) { reasons.push(server + ': ' + text(err)) }
    // The desktop app keeps its connectors to itself, so $.mcp.call can't reach them; the same
    // call made as the model makes it can.
    if (server !== 'claude.ai SkillKey') {
      try {
        listed = (await $.tool.list()).some(t => (typeof t === 'string' ? t : t.name) === 'mcp__' + server + '__' + tool)
        const r = await $.tool.call({ tool: 'mcp__' + server + '__' + tool, ...(args || {}) })
        // SkillKey always answers with text; an empty answer counts as no answer.
        if (r && !r.deny && !r.isError && String(r.text ?? '').trim()) return { content: [{ type: 'text', text: String(r.text) }], isError: false }
        reasons.push('as the model: ' + (r && r.deny ? r.deny : String(r?.text ?? 'no answer')))
      } catch (err) { reasons.push('as the model: ' + text(err)) }
    }
  }
  // A connector id saved from another Claude account isn't here: forget it, so YouCloned shows the
  // Connect SkillKey step instead of an error.
  const why = reasons.join(' | ')
  // In the first minute of a session the app may still be connecting SkillKey: show Connect for now,
  // keep the saved id, and look again later.
  if (!listed && /not connected|no connected|unknown server|not found/i.test(why)) {
    let settled = true
    try { settled = (await $.clock.now()) - sessionStartedAt > 60000 } catch {}
    skillKeyServer = null; skillKey = false
    if (settled) { try { await $.store.set('skillKeyServer', '') } catch {} }
    $.ui.invalidate('ui.render')
  }
  throw new Error('SkillKey did not answer: ' + why.slice(0, 600))
}

// Jon's instructions for one YouCloned skill, from SkillKey. Only the part between the markers
// is used, so SkillKey's own notes (word balance, run_skill) never reach the crew.
async function fromSkillKey($, slug, quiet = false) {
  try {
    const r = await skillKeyCall($, 'start_skill', { skill: slug })
    const text = (r.content || []).map(c => c.text || '').join('\n')
    const m = /<<<YOUCLONED>>>\n([\s\S]*?)\n<<<END YOUCLONED>>>/.exec(text)
    if (m) { notOwned.delete(slug); return m[1].trim() }
    if (/not on this account/i.test(text)) notOwned.add(slug)
    return null
  } catch (err) {
    // SkillKey not connected is a setup step, not an error: say the one step, never the raw message.
    if (/no connected|not connected|unknown server|not found/i.test(String(err))) { if (!quiet) $.ui.log('SkillKey isn\'t connected in this Claude account yet. Open ' + SKILLKEY_INSTALL + ' and follow the Connect SkillKey step.') }
    else if (!quiet) $.ui.log('SkillKey ' + slug + ': ' + String(err).slice(0, 700))
    return null
  }
}

const PRO_ONLY = (title) => 'The ' + title + ' helper isn\'t on your SkillKey account yet, so this one stays off.'
const NEEDS_SKILLKEY = 'SkillKey isn\'t connected in this Claude account yet, so Jon\'s skills can\'t load. Connecting takes about a minute: open ' + SKILLKEY_INSTALL + ', click Copy SkillKey address, then in Claude click Add, then Add custom connector, and paste it.'

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

async function registerCrew($, quiet = false) {
  for (const c of CREW) {
    if (crewReady.has(c.name)) continue
    const prompt = await fromSkillKey($, 'youcloned-crew-' + c.name, quiet)
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

// The feed-me helpers: the librarian (Haiku) and the wiki writer (Sonnet). Their instructions are the
// add-on's agents/<name>.md files. The librarian gets the Gmail connector's two look-up tools under
// whatever name this Claude gives the connector (the desktop app names it by an id).
async function registerHelpers($) {
  const names = []
  try { for (const t of await $.tool.list()) names.push(typeof t === 'string' ? t : t.name || '') } catch {}
  try { for (const t of (await $.session.usage({ breakdown: 'summary' }))?.context?.breakdown?.mcpTools || []) names.push(t.name) } catch {}
  const done = []
  for (const h of HELPERS) {
    const file = $.plugin.root + '/agents/' + h.name + '.md'
    if (!(await $.fs.exists(file))) continue
    const a = parseAgent(await $.fs.read(file))
    if (!a || a.name !== h.name) { $.ui.log('feed-me helper ' + h.name + ': its agents file has no name, description or prompt'); continue }
    const tools = h.name === 'librarian' ? [...new Set([...a.tools, ...gmailReads(names)])] : a.tools
    await $.agent.register({ name: h.name, description: a.description, prompt: a.prompt, model: a.model, tools, maxTurns: h.maxTurns, omitClaudeMd: true })
    done.push(h.name)
  }
  return done
}

async function isHelper($, e) {
  const id = e.agentId
  if (!id) return null
  if (helperIds.has(id)) return helperIds.get(id)
  if (notHelper.has(id)) return null
  const a = (await $.agent.list()).find(x => x.id === id)
  const m = a && /^youcloned:(.+)$/.exec(a.type)
  if (m && HELPERS.some(h => h.name === m[1])) {
    helperIds.set(id, m[1])
    return m[1]
  }
  if (a) notHelper.add(id)
  return null
}

async function helperContext($) {
  const folder = await cloneFolder($)
  return { feed: $.plugin.root + '/library/feed.py', scratch: home + '/.youcloned/feeding', library: folder ? folder + '/Library' : '', folder: folder || '' }
}

// Run now: a helper set up already starts at once. One that isn't yet needs its steps from SkillKey,
// which Auto mode allows only inside a request, so Claude is asked to run it with the helper tool.
async function crewNow($, name) {
  const c = CREW.find(x => x.name === name)
  if (!c || !project || crew[name].running) return runCrew($, name)
  if (!crewReady.has(name)) { await checkSkillKey($); try { await registerCrew($, true) } catch {} }
  if (crewReady.has(name) || !skillKeyServer || notOwned.has('youcloned-crew-' + name)) return runCrew($, name)
  // Sent a moment later: a command or a button can't start a turn while it is still running.
  $.clock.after(0, async () => {
    try { await $.prompt.submit({ text: 'Run my ' + c.title + ' helper.' }) }
    catch (err) { $.ui.log('could not ask Claude to run the ' + c.title + ' helper: ' + String(err).slice(0, 200)) }
  })
  return 'Starting your ' + c.title + ' helper…'
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
  // Isaac's voice conversation: the Talk button and the dashboard glow while converse runs.
  // A second press of Talk ends the running call: returning while next is pending aborts it, and the
  // deny text tells Isaac the owner stopped him, so he does not start listening again on his own.
  on('tool.call', { tool: 'mcp__plugin_voicemode_voicemode__converse' }, async ($, e, next) => {
    listening = true; await writeState($); $.ui.invalidate('ui.render')
    const stopped = new Promise(res => { stopTalk = () => res({ deny: STOPPED }) })
    try { return await Promise.race([next(e), stopped]) } finally {
      stopTalk = null; listening = false; await writeState($); $.ui.invalidate('ui.render')
    }
  })

  // The Talk to Isaac button (hooks/talk.js) was pressed.
  on('ui.message', async ($, e, next) => {
    if (!/talk\.js$/.test(String(e.module || ''))) return next(e)
    await pressTalk($)
    return {}
  })

  // The key guards: no key goes into a file or a command, nothing prints a secret, and the owner's
  // own banned words stay out of what gets written. They run for every chat, crew or not.
  on('tool.call', { tool: /^(Write|Edit|MultiEdit|NotebookEdit|Bash)$/ }, async ($, e, next) => {
    if (e.tool === 'Bash') {
      const why = commandReason(e.command)
      return why ? { deny: 'YouCloned blocked this command: ' + why + '. Keep keys in a git-ignored .env file or your host\'s secret store, and never print them.' } : next(e)
    }
    const text = writtenText(e)
    const key = firstKey(text)
    if (key && !(isEnvFile(e.file_path) && (await envFileAllowed($, e.file_path)))) {
      return { deny: 'YouCloned blocked this write: it holds a ' + key + '. Put the key in a git-ignored .env file or your host\'s secret store.' }
    }
    const bans = await loadBans($)
    // The librarian's scratch files hold the owner's own sent emails on their way into the library,
    // so the owner's banned words (meant for what Claude writes) don't keep them out. Keys still do.
    const ownWords = e.agentId && (await isHelper($, e)) === 'librarian' && helperJudge('librarian', e, await helperContext($)) === null
    const found = bans && !ownWords ? bannedIn(text, bans) : []
    if (found.length) return { deny: 'YouCloned blocked this write: ' + bans.message + ' Banned: ' + found.join(', ') + '.' }
    return next(e)
  })

  // The safety gate runs first, so no crew call reaches a tool without it. It fails closed.
  // The feed-me helpers have their own gate: feed.py only, writes only in their own folder, Gmail look-ups only.
  on('tool.call', async ($, e, next) => {
    const helper = await isHelper($, e)
    if (helper) {
      const no = helperJudge(helper, e, await helperContext($))
      if (no) {
        $.ui.log('safety gate refused ' + e.tool + ' for the ' + helper + ': ' + no)
        return { deny: helperDenyText(helper, no) }
      }
      return next(e)
    }
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
    if (e.agentId && helperIds.has(e.agentId)) {
      return { deny: helperDenyText(helperIds.get(e.agentId), 'the gate itself failed (' + next.error.kind + '), so the call was refused') }
    }
    if (e.agentId && (crewIds.has(e.agentId) || !notCrew.has(e.agentId))) {
      return { deny: denyText('the gate itself failed (' + next.error.kind + '), so the call was refused') }
    }
    return next(e)
  })

  // YouCloned's own SkillKey look-ups (the skill list, a skill's steps, the word balance) read and
  // change nothing, so they never wait on a permission question or Auto mode's classifier, which
  // refuses a plugin's call it has no conversation to judge. run_skill keeps the normal check.
  on('tool.check', { tool: /^mcp__.+__(list_skills|start_skill|word_balance)$/ }, async ($, e, next) => {
    const m = /^mcp__(.+)__(list_skills|start_skill|word_balance)$/.exec(e.tool || '')
    if (m && skillKeyServer && (m[1] === skillKeyServer || m[1] === skillKeyServer.replace(/[^A-Za-z0-9_-]/g, '_'))) {
      return { decision: 'allow', reason: 'a SkillKey look-up by YouCloned' }
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
    try { sessionStartedAt = await $.clock.now() } catch {}
    interactive = e.isInteractive
    await loadState($)
    try { version = JSON.parse(await $.fs.read($.plugin.root + '/.claude-plugin/plugin.json')).version || '' } catch {}
    pluginRoot = $.plugin.root
    try { await refreshDrafts($) } catch {}
    await checkSkillKey($)
    try { const saved = await $.store.get('pins'); if (Array.isArray(saved)) pins = saved.filter(k => typeof k === 'string') } catch {}
    if (skillKey) $.clock.after(1500, () => loadSkillKeySkills($))
    // YouCloned shows itself only in the clone folder: a folder with the rules file, or the one setup saved.
    try {
      const cwd = await openedFolder($)
      const rulesHere = await $.fs.exists(cwd + '/' + RULES_NAME)
      cloneHere = rulesHere || !!(project && (cwd === project || cwd.startsWith(project + '/'))) || !!(everywhere && project)
      if (rulesHere) project = cwd
      // The desktop app reports its sessions as not interactive, so it counts by its surface.
      watched = e.isInteractive || e.surface === 'desktop'
      deskSession = e.surface === 'desktop'
      if (cloneHere && watched) await turnOn($, cwd)
    } catch (err) { $.ui.log('YouCloned clone check failed: ' + String(err)) }
    if (deskSession && onMac()) $.clock.after(3000, () => nudgeDevTools($))
    try {
      await $.tool.register({
        name: 'setup_next',
        description: 'Night-one setup, one step at a time in the only order that works. Checks every step on this computer and says exactly what to do next. Call it to start or continue setup, after each step, with folder once the person picks their clone folder, or with skip (voice or feed) when they want to do that step later.',
        inputSchema: {
          type: 'object',
          properties: {
            folder: { type: 'string', description: 'The clone folder the person chose, as a full path' },
            skip: { type: 'string', enum: [...CAN_SKIP], description: 'A step the person wants to do later' },
            resume: { type: 'boolean', description: 'True when the person says "finish my setup": brings back the steps they put off' },
          },
        },
      })
    } catch (err) { $.ui.log('setup_next not registered: ' + String(err)) }
    try {
      await $.tool.register({
        name: 'save_setup',
        description: 'Save the customer\'s YouCloned rules file after the youcloned:setup interview. Refuses a setup with an empty section or fewer than two writing samples the customer wrote themselves.',
        inputSchema: {
          type: 'object',
          properties: {
            folder: { type: 'string', description: 'Where their YouCloned work goes; leave out for the default, the folder this conversation is open in' },
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
        name: 'work_without_prompts',
        description: 'Saves the person\'s answer to the setup question about letting their clone work without permission prompts. With allow true it turns on Claude Code\'s bypass permission mode in their user settings (backing the file up first, keeping every other setting); with allow false it changes nothing. Call it only with the answer they gave.',
        inputSchema: { type: 'object', properties: { allow: { type: 'boolean', description: 'true if they said yes, false if they said no' } }, required: ['allow'] },
      })
    } catch (err) { $.ui.log('work_without_prompts not registered: ' + String(err)) }
    try {
      await $.tool.register({
        name: 'helper',
        description: 'Runs one of the owner\'s YouCloned crew helpers (support or inbox) and says what it started. Call it when the person presses Run now or asks a helper to run.',
        inputSchema: { type: 'object', properties: { name: { type: 'string', enum: CREW.map(c => c.name), description: 'Which helper to run' } }, required: ['name'] },
      })
    } catch (err) { $.ui.log('helper tool not registered: ' + String(err)) }
    try {
      await $.tool.register({
        name: 'codex_check',
        description: 'Ask the customer\'s own Codex (OpenAI) to check work, read-only. With no question it reviews the uncommitted changes, or your last answer and the files it names. Use it when the customer asks for a second opinion or a Codex check.',
        inputSchema: { type: 'object', properties: { question: { type: 'string', description: 'What Codex should check; leave out to check the last piece of work' } } },
      })
    } catch (err) { $.ui.log('codex_check not registered: ' + String(err)) }
    if (cloneHere) {
      // SkillKey may still be connecting when a session starts, so the crew is set up after a short wait
      // and again later if a member is still missing.
      const setUpCrew = async () => {
        if (CREW.every(c => crewReady.has(c.name))) return
        await checkSkillKey($)
        if (!skillKeyServer) return
        try { await registerCrew($, true) } catch {}
        $.ui.invalidate('ui.render')
      }
      try { await registerHelpers($) } catch (err) { $.ui.log('feed-me helpers not registered: ' + String(err).slice(0, 200)) }
      await setUpCrew()
      $.clock.after(15000, setUpCrew)
      $.clock.after(60000, setUpCrew)
    }
    try {
      await $.command.register({
        name: 'youcloned',
        description: 'Open YouCloned. "setup" sets you up, "codex" checks the last work with Codex, "crew support" or "crew inbox" runs a crew member',
        argumentHint: '[setup | on | off | codex [question] | crew <support|inbox>]',
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const theirs = await next(e)
    // In the desktop app the YouCloned button is Claude's blue main button and each job sits in a blue outline.
    const desk = e.surface === 'desktop'
    const job = (j) => {
      const b = Button({ key: 'yc-job-' + j.key, label: j.label, plain: true, onPress: () => pressJob($, j) })
      return desk ? Box({ borderStyle: 'round', borderColor: BLUE, paddingX: 1, children: [b] }) : b
    }
    const facts = []
    if (live.claudePct != null) facts.push('Claude ' + Math.round(Math.max(0, 100 - live.claudePct)) + '% left')
    if (live.words != null) facts.push(Number(live.words).toLocaleString('en-US') + ' words')
    const strip = Box({ flexDirection: 'column', rowGap: 0, children: [
      Box({ flexDirection: 'row', columnGap: 2, children: [
        Text({ bold: true, color: BLUE, children: ['YouCloned'] }),
        ...(version ? [Text({ dimColor: true, children: [version] })] : []),
        Text({ dimColor: true, children: [facts.join(' · ') || 'your clone is on'] }),
      ] }),
      ...(project ? [Text({ children: ['Open ', Text({ bold: true, color: BLUE, children: ['YouCloned'] }), ': click the globe at the top right'] })] : []),
      Box({ flexDirection: 'row', columnGap: 2, children: [
        project
          ? Button({ key: 'yc-open', label: 'YouCloned', ...(desk ? { variant: 'primary' } : { plain: true }), onPress: () => togglePane($) })
          : Button({ key: 'yc-setup', label: 'Set up YouCloned', plain: true, onPress: () => openDashboard($) }),
        ...pinnedSkills().slice(0, 4).map(job),
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
    const running = version ? 'YouCloned version ' + version + ' is running in this conversation (tell the person this number if they ask which version they have).\n\n' : ''
    const block = { name: 'youcloned', text: running + 'The owner\'s YouCloned rules, from ' + project + '/' + RULES_NAME +
      '. Follow them in everything you write for this person.\n\n' + rules + '\n\nRules every YouCloned clone follows:\n\n' + UNIVERSAL_RULES + LIBRARY_NOTE() }
    return { ...result, blocks: [...result.blocks, block] }
  })

  on('tool.call', { tool: 'mcp__youcloned__save_setup' }, async ($, e) => {
    const problems = checkSetup(e)
    if (problems.length) return { result: 'Not saved. Fix these and call save_setup again:\n- ' + problems.join('\n- ') }
    const folder = expandHome(e.folder) || (await cloneFolder($)) || await defaultFolder($)
    if (!/^([A-Za-z]:)?[\\/]/.test(folder)) return { result: 'Not saved: the folder must be a full path, such as ' + home + '/YouCloned.' }
    await $.fs.write(folder + '/' + RULES_NAME, rulesMarkdown(e))
    for (const c of CREW) {
      await $.fs.write(folder + '/crew/' + c.name + '/drafts/.keep', '')
      if (c.name === 'support') await $.fs.write(folder + '/crew/support/inbox/.keep', '')
    }
    project = folder
    await $.store.set('project', folder)
    if (!(await $.store.get('folder'))) {
      await $.store.set('folder', folder)
      try { await $.fs.write(dataDir() + '/vault-path', folder + '\n') } catch {}
    }
    everywhere = true
    await $.store.set('everywhere', true)
    // Switch on in this same chat: the bar, the dashboard and the crew, so the buyer needs no new chat.
    cloneHere = true
    if (watched) { try { await turnOn($, await openedFolder($)) } catch {} }
    try { await registerHelpers($) } catch {}
    try { await checkSkillKey($); if (skillKeyServer) await registerCrew($, true) } catch {}
    await refreshDrafts($)
    $.ui.invalidate('ui.render')
    return { result: 'Saved. Rules file: ' + folder + '/' + RULES_NAME + '. Crew folders: ' + folder + '/crew/support and ' + folder + '/crew/inbox. Every new conversation reads the rules file. ' + SYNC_NOTE }
  })

  on('tool.call', { tool: 'mcp__youcloned__setup_next' }, async ($, e) => ({ result: await setupNext($, e) }))
  on('tool.call', { tool: 'mcp__youcloned__work_without_prompts' }, async ($, e) => {
    return { result: await setNoPrompts($, e.allow === true) }
  })

  on('tool.call', { tool: 'mcp__youcloned__load_setup' }, async ($) => {
    if (!skillKeyServer) await checkSkillKey($)
    const text = await fromSkillKey($, 'youcloned-setup')
    if (!text) return { result: NEEDS_SKILLKEY + ' Tell the person exactly that, and stop.' }
    let devtools = ''
    try { if (onMac() && (await run($, ['/usr/bin/xcode-select', '-p'])).exitCode !== 0) devtools = '\n\nBefore the first question, tell them in one or two short sentences: ' + DEVTOOLS_NOTE + ' They can keep going here while it installs.' } catch {}
    const chosen = await cloneFolder($)
    const where = chosen ? '\n\nFolder: they already chose ' + chosen + ' in setup. Don\'t ask again; leave folder out of save_setup.'
      : '\n\nFolder: the default is ' + (await defaultFolder($)) + ' (the folder this conversation is open in, or YouCloned in their home folder). Offer that as the default, and leave folder out of save_setup when they take it.'
    let noPrompts = ''
    try { if (!(await $.store.get('noPromptsAsked')) && !(await noPromptsOn($))) noPrompts = '\n\n' + NO_PROMPTS_NOTE } catch {}
    return { result: text + where + devtools + noPrompts }
  })

  // Learns SkillKey's name the moment Claude itself uses it, for apps whose tool list leaves it out.
  on('tool.call', { tool: /^mcp__.+__(list_skills|start_skill|run_skill|word_balance)$/ }, async ($, e, next) => {
    const m = /^mcp__(.+)__(list_skills|start_skill|run_skill|word_balance)$/.exec(e.tool || '')
    if (m && m[1] !== skillKeyServer && !/youcloned/.test(m[1])) {
      skillKeyServer = m[1]; skillKey = true
      try { await $.store.set('skillKeyServer', m[1]) } catch {}
    }
    const r = await next(e)
    // Every SkillKey answer that names the balance updates the words gauge.
    const w = /words left:\s*([\d,]+)/i.exec(String(r?.text ?? ''))
    if (w) {
      live.words = Number(w[1].replace(/,/g, ''))
      try { await writeState($) } catch {}
      $.ui.invalidate('ui.render')
    }
    return r
  })

  // The helper tool runs inside the model's request, where Auto mode lets YouCloned reach SkillKey.
  on('tool.call', { tool: 'mcp__youcloned__helper' }, async ($, e) => {
    return { result: await runCrew($, String(e.name || '').toLowerCase()) }
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
    if (word === 'codex') return { text: await codexCheck($, args.slice(5).trim()) }
    if (word === 'crew') {
      const name = args.split(/\s+/)[1] || ''
      return { text: await crewNow($, name.toLowerCase()) }
    }
    if (interactive) {
      await openPane($, true)
      return {}
    }
    return { text: project ? 'YouCloned is set up. Rules file: ' + project + '/' + RULES_NAME : 'YouCloned is not set up yet. Run /youcloned setup.' }
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
    const redraw = () => $.ui.invalidate('ui.render')
    const width = Math.max(30, (e.props.bodyColumns || 60) - 2)
    // The drawings follow the panel's width so text stays at its normal size instead of growing with it.
    if (e.surface === 'desktop') {
      setWidth((e.props.bodyColumns || 110) * 8.4)
      if (e.props.bodyColumns !== lastColumns) {
        lastColumns = e.props.bodyColumns
        try { await $.fs.write(dataDir() + '/panel.json', JSON.stringify({ bodyColumns: lastColumns, at: now })) } catch {}
      }
    }
    const now = await $.clock.now()

    const header = Box({ flexDirection: 'row', columnGap: 2, children: [
      Text({ bold: true, children: ['YouCloned'] }),
      Text({ dimColor: true, children: [project ? 'Your rules are on' : 'Not set up yet'] }),
    ] })
    const tabs = Box({ flexDirection: 'row', columnGap: 3, children: TABS.map(([id, label]) => Button({
      key: 'tab-' + id, label, plain: true, dimColor: tab !== id, onPress: () => { tab = id; redraw() },
    })) })

    // No fixed size: each drawing is marked wider than any panel, so the desktop app draws it at the
    // panel's full width and keeps its shape.
    const BIG = 2400
    const pic = (alt, svg) => Svg({ alt, source: svg.replace(/ width="(\d+)" height="(\d+)"/, (_, w, h) => ' width="' + BIG + '" height="' + Math.round(h * BIG / w) + '"') })

    let body = []
    if (tab === 'home') {
      const desk = e.surface === 'desktop'
      const left = live.claudePct == null ? null : 100 - live.claudePct
      const reset = live.claudeLabel && live.claudeLabel.includes('resets ') ? live.claudeLabel.split('resets ')[1] : ''
      const waiting = CREW.map(c => ({ c, n: crew[c.name].drafts.length }))
      const lines = waiting.filter(x => x.n).map(x => x.c.title + ' helper: ' + x.n + (x.n === 1 ? ' draft' : ' drafts') + ' waiting for you')
      if (!lines.length) lines.push('Your crew is caught up')
      lines.push('New from Jon: ' + promo.title)
      if (desk) {
        // The Dashboard: display cards are pictures; every action card is a Claude box in the dashboard's
        // navy with a drawn header, and every button is a Claude button or link inside a blue box.
        let name = ''
        try { const m = ((await readRules($)) || '').match(/^#+\s*Who I am\s*\n+([^\n]+)/m); name = m ? m[1].trim().split(/[ ,]/)[0] : '' } catch {}
        const ycBox = (child, fill) => Box({ borderStyle: 'round', borderColor: BLUE, ...(fill ? { backgroundColor: BLUE } : {}), paddingX: 1, children: [child] })
        const ycButton = (key, label, onPress, fill) => ycBox(Button({ key, label, plain: true, onPress }), fill)
        const ycLink = (href, label, fill) => ycBox(Link({ href, label }), fill)
        const card = (head, children) => Box({ flexDirection: 'column', backgroundColor: CARD, borderStyle: 'round', borderColor: CARD_LINE, children: [
          pic(head.title, cardHeadSvg(head)),
          Box({ flexDirection: 'column', paddingX: 2, paddingY: 1, rowGap: 1, children }),
        ] })
        const row = (children) => Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1, rowGap: 1, alignItems: 'center', children })

        body.push(pic('Your day: plan left, Codex and BNSN words', heroSvg({ name, left, reset, span: live.claudeSpan, words: live.words, codex: codexReady, codexPlan: live.codex || null, lines })))
        body.push(Client
          ? Client({ key: 'talk', module: './talk.js', props: { listening } })
          : ycButton('home-talk', listening ? 'Isaac is listening · press to stop' : 'Talk to Isaac', () => pressTalk($), true))
        body.push(row([ycButton('home-new-project', NEW_PROJECT.label, () => pressJob($, NEW_PROJECT), false)]))

        // Not connected (a new buyer, or a switched Claude account): one plain card with the way in.
        if (!skillKey) body.push(card({ icon: 'key', color: '#5a92ea', title: 'Connect SkillKey' }, [
          Text({ wrap: 'wrap', children: ['Jon\'s skills and your word balance run on SkillKey. Connect it once in this Claude account and every skill shows up here. It takes about a minute.'] }),
          row([
            ycLink(SKILLKEY_INSTALL, 'Connect SkillKey', true),
            Button({ key: 'home-skillkey-check', label: 'I\'ve connected it', plain: true, dimColor: true, onPress: async () => {
              await checkSkillKey($)
              if (skillKey) { await loadSkillKeySkills($); await refreshLive($, true); $.ui.toast('SkillKey is connected') }
              else $.ui.toast('SkillKey isn\'t showing yet. Start a new session after connecting it.')
            } }),
          ]),
        ]))

        const pinned = pinnedSkills()
        body.push(card({ icon: 'play', color: '#5a92ea', title: 'Start a job', meta: 'Pinned skills' }, [row([
          ...pinned.map((j, i) => ycButton('home-job-' + j.key, j.label, () => pressJob($, j), i === 0)),
          Button({ key: 'home-all', label: 'All skills', plain: true, dimColor: true, onPress: () => { tab = 'skills'; redraw() } }),
        ])]))

        body.push(pic('Made or saved this week (sample)', moneySvg(MONEY_SAMPLE)))

        const need = CREW.filter(c => crew[c.name].drafts.length).length
        body.push(card({ icon: 'crew', color: AMBER, title: 'Your crew', meta: need ? need + (need === 1 ? ' needs you' : ' need you') : 'All caught up' },
          CREW.map(c => {
            const st = crew[c.name]
            const n = st.drafts.length
            const status = st.running ? 'Working…' : n ? n + (n === 1 ? ' draft waiting' : ' drafts waiting') : 'Caught up' + (st.lastRun ? ' · ran ' + ago(st.lastRun, now) : '')
            return Box({ flexDirection: 'row', columnGap: 1, alignItems: 'center', children: [
              Box({ flexDirection: 'column', flexGrow: 1, children: [
                Text({ children: [Text({ bold: true, children: [c.title + ' helper'] }), '  ', Text({ bold: true, color: n ? AMBER : BLUE_INK, children: [status] })] }),
                Text({ dimColor: true, wrap: 'wrap', children: [c.what] }),
              ] }),
              ...(n ? [ycButton('home-review-' + c.name, 'Review ' + n + (n === 1 ? ' draft' : ' drafts'), () => pressJob($, reviewJob(c)), true)] : []),
              ycButton('home-run-' + c.name, st.running ? 'Working…' : 'Run now', async () => { $.ui.toast(await crewNow($, c.name)) }),
            ] })
          })))

        const owned = new Set([...OWNED_SAMPLE, ...(skillKey ? ['skillkey'] : [])])
        body.push(card({ icon: 'apps', color: '#5a92ea', title: 'Your BNSN apps' }, [row(APPS.map(a => Box({ flexDirection: 'column', rowGap: 1, alignItems: 'stretch', children: [
          Svg({ alt: a.key, source: plateSvg(a.key), width: PLATE.w, height: PLATE.h }),
          a.soon ? Text({ dimColor: true, children: [a.soon] })
            : owned.has(a.key) ? ycLink(a.open, 'Open', false) : ycLink(a.get, a.join ? 'Join' : 'Get it', true),
        ] })))]))

        body.push(card({ icon: 'play', color: '#5a92ea', title: 'New from Jon' }, [Box({ flexDirection: 'row', columnGap: 2, alignItems: 'center', children: [
          Svg({ alt: 'Thumbnail', source: thumbSvg(promoThumb), width: THUMB.w, height: THUMB.h }),
          Box({ flexDirection: 'column', flexGrow: 1, rowGap: 1, children: [
            Text({ bold: true, wrap: 'wrap', children: [promo.title] }),
            Text({ dimColor: true, wrap: 'wrap', children: [promo.note] }),
            row([
              ycButton('home-new', promo.button, () => pressJob($, { label: promo.button, text: promo.text }), true),
              ...(promo.watch ? [ycLink(promo.watch, 'Watch the video', false)] : []),
            ]),
          ] }),
        ] })]))

        body.push(Text({ dimColor: true, children: ['The full ', Text({ bold: true, color: BLUE_INK, children: ['YouCloned'] }), ' dashboard: click the globe at the top right'] }))
      } else {
        body.push(Text({ bold: true, color: BLUE, children: ['YouCloned'] }))
        body.push(Text({ children: ['Claude plan left: ' + (left == null ? '?' : Math.round(left) + '%') + '   BNSN words: ' + (live.words == null ? 'not linked' : Number(live.words).toLocaleString('en-US'))] }))
        body.push(Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1, rowGap: 0, children: [
          ...pinnedSkills().map(j => Button({ key: 'home-job-' + j.key, label: j.label, onPress: () => pressJob($, j) })),
          Button({ key: 'home-all', label: 'All skills', plain: true, onPress: () => { tab = 'skills'; redraw() } }),
        ] }))
        body.push(Box({ flexDirection: 'row', columnGap: 2, children: [
          Button({ key: 'home-crew', label: 'Open my crew', plain: true, onPress: () => { tab = 'crew'; redraw() } }),
          Button({ key: 'home-codex', label: codex.busy ? 'Codex is checking…' : 'Check with Codex', plain: true, onPress: () => codexButton($) }),
          Button({ key: 'home-dash', label: 'Full dashboard', plain: true, onPress: () => openDashboard($) }),
        ] }))
        body.push(Text({ wrap: 'wrap', children: ['New from Jon: ' + promo.title] }))
        body.push(Button({ key: 'home-new', label: promo.button, onPress: () => pressJob($, { label: promo.button, text: promo.text }) }))
      }
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
            Button({ key: 'run-' + c.name, label: s.running ? 'Working…' : 'Run now', onPress: async () => { $.ui.toast(await crewNow($, c.name)) } }),
            ...(s.drafts.length ? [Button({ key: 'review-' + c.name, label: 'Review drafts', onPress: () => pressJob($, reviewJob(c)) })] : []),
          ] }),
          Select({ key: 'every-' + c.name, label: 'Runs', value: String(s.every || 0), options: SCHEDULES,
            onSelect: async (value) => { s.every = Number(value); await saveCrew($); redraw() } }),
        ] }))
      }
    }
    if (tab === 'skills') {
      body.push(Input({ key: 'skill-search', label: 'Find a skill', placeholder: 'Type a word and press Enter', value: skillQuery, submitLabel: 'find',
        onSubmit: (value) => { skillQuery = String(value || '').trim(); redraw() } }))
      // Each skill is a card: its name, what it does, Start and Pin. Two cards across when the panel is wide.
      const cardWidth = width >= 84 ? Math.floor((width - 1) / 2) : width
      const card = (sk) => {
        const isPinned = pins.includes(sk.key)
        return Box({ key: 'card-' + sk.key, flexDirection: 'column', borderStyle: 'round', paddingX: 1, width: cardWidth, children: [
          Text({ bold: true, children: [sk.label] }),
          Text({ dimColor: true, wrap: 'wrap', children: [sk.what] }),
          Box({ flexDirection: 'row', columnGap: 2, children: [
            Button({ key: 'skill-' + sk.key, label: 'Start', onPress: () => pressJob($, sk) }),
            Button({ key: 'pin-' + sk.key, label: isPinned ? 'Unpin' : 'Pin to Dashboard', plain: true, dimColor: true, onPress: () => togglePin($, sk.key) }),
          ] }),
        ] })
      }
      const group = (title, list) => {
        if (!list.length) return
        body.push(Text({ bold: true, children: [title] }))
        body.push(Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1, rowGap: 1, children: list.map(card) }))
      }
      const q = skillQuery.toLowerCase()
      if (q) {
        const found = allSkills().filter(sk => (sk.label + ' ' + sk.what).toLowerCase().includes(q))
        body.push(Button({ key: 'skill-clear', label: 'Show all ' + allSkills().length + ' skills', plain: true, onPress: () => { skillQuery = ''; redraw() } }))
        if (found.length) group('Skills that match "' + skillQuery + '"', found)
        else body.push(Text({ dimColor: true, children: ['No skill matches "' + skillQuery + '".'] }))
      } else {
        const fromJon = new Set(skillKeySkills.map(sk => sk.key))
        group('On your Dashboard', pinnedSkills())
        group('Jon\'s skills', allSkills().filter(sk => fromJon.has(sk.key) && !pins.includes(sk.key)))
        group('Everyday jobs', allSkills().filter(sk => !fromJon.has(sk.key) && !pins.includes(sk.key)))
      }
      if (!skillKey) body.push(Box({ flexDirection: 'row', columnGap: 2, flexWrap: 'wrap', children: [
        Text({ dimColor: true, wrap: 'wrap', children: ['Jon\'s voice, VSL and conversion skills show up here once SkillKey is connected.'] }),
        Link({ href: SKILLKEY_INSTALL, label: 'Connect SkillKey' }),
      ] }))
    }
    if (tab === 'money') {
      if (e.surface === 'desktop') body.push(pic('Made or saved this week (sample)', moneySvg(MONEY_SAMPLE)))
      else body.push(Text({ children: ['Made or saved this week (sample): $' + MONEY_SAMPLE.total.toLocaleString('en-US')] }))
      body.push(Text({ dimColor: true, wrap: 'wrap', children: ['These numbers are a sample. Your own sales from Stripe and the time your clone saves you show here once they are connected.'] }))
    }
    if (tab === 'setup') {
      body.push(Text({ bold: true, children: ['Your clone'] }))
      body.push(Text({ dimColor: true, wrap: 'wrap', children: [project ? 'Your rules are on: ' + project + '/' + RULES_NAME : 'Tell your clone who you are, what you sell and how you sound. Everything works better after this.'] }))
      body.push(Button({ key: 'setup', label: project ? 'Redo my setup' : 'Set me up (about 5 minutes)', autoFocus: !project, onPress: () => startSetup($) }))
      body.push(Text({ bold: true, children: ['Codex'] }))
      body.push(Text({ dimColor: true, wrap: 'wrap', children: [codex.note || (codexReady ? 'Ready. Your own Codex gives a second opinion on Claude\'s work.' : 'Codex is not on this computer yet.')] }))
      body.push(Button({ key: 'codex', label: codex.busy ? 'Codex is checking…' : 'Check with Codex', plain: true, onPress: () => codexButton($) }))
      body.push(Text({ bold: true, children: ['SkillKey'] }))
      body.push(Text({ dimColor: true, wrap: 'wrap', children: [skillKey ? 'Connected. Jon\'s skills run from here.' : 'Not connected. Jon\'s skills unlock once SkillKey is connected to your Claude app.'] }))
      if (!skillKey) body.push(Link({ href: SKILLKEY_INSTALL, label: 'Connect SkillKey (about a minute)' }))
      body.push(Text({ bold: true, children: ['Voice'] }))
      body.push(Text({ dimColor: true, wrap: 'wrap', children: ['Talk to your clone out loud. Coming in a later version.'] }))
      body.push(Button({ key: 'setup-dash', label: 'Open the full dashboard', plain: true, onPress: () => openDashboard($) }))
    }

    const top = tab === 'home' && e.surface === 'desktop' ? [pic('YouCloned', topSvg()), tabs] : [header, tabs]
    return Box({ flexDirection: 'column', width, rowGap: 1, children: [...top, ...body] })
  })
}
