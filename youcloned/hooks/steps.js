// The night-one setup, in the only order that works: each step needs the ones before it.
// register.js checks every step on this computer (never assumed) and setup_next hands Claude the first
// one that isn't done, so a buyer goes from a fresh Claude to a clone that knows them in one evening.
//   tools      Git, Node, Python, ffmpeg, Obsidian and the GitHub tool; everything after needs them
//   home       the clone's folder (an Obsidian vault); the rules file, backups and the env file live here
//   protection the key check on every commit, before anything is saved to GitHub
//   skillkey   Jon's skills and the interview's own steps come from SkillKey
//   interview  who they are, what they sell, who buys, how they sound: the rules file
//   skills     the starter skills pack
//   backup     a private GitHub copy of the folder, every night
//   library    their own Supabase: the library the clone searches, and its wiki
//   voice      the free voice on their own computer
//   feed       "feed me": the clone's first sources go into the library

export const STEPS = [
  { id: 'tools', title: 'Your tools', why: 'Installs Git, Node, Python, the video tools, Obsidian and GitHub\'s tool. Skips anything you already have.' },
  { id: 'home', title: 'Your clone\'s home', why: 'A folder that becomes your Obsidian vault, where your clone keeps your rules, notes and work.' },
  { id: 'protection', title: 'Protection', why: 'Checks every save for passwords and keys before anything leaves your computer.' },
  { id: 'skillkey', title: 'SkillKey', why: 'Connects Jon\'s skills. The interview\'s steps come from here too.' },
  { id: 'interview', title: 'Teach your clone', why: 'A ten-minute interview: your business, offers, buyers, voice, brand and two pieces of your writing.' },
  { id: 'skills', title: 'Jon\'s starter skills', why: 'The skills pack your clone writes and builds with.' },
  { id: 'backup', title: 'Back up to GitHub', why: 'A private copy of your clone folder, saved every night.' },
  { id: 'library', title: 'Your library', why: 'A free Supabase database where your clone keeps everything you feed it, searchable by meaning.' },
  { id: 'voice', title: 'Your clone\'s voice', why: 'A free voice that runs on your own computer, so your clone talks to you tonight.' },
  { id: 'feed', title: 'Feed me', why: 'Your emails, pages, videos and documents go into your library, so your clone sounds like you.' },
]

export const STEP_IDS = STEPS.map(s => s.id)

// Steps outside the ten, added only when the owner asks for them (setup_next with only).
// Codex is optional, in week one, with the "clone checks itself" lesson (Jon, Oct 17 4:26pm).
export const EXTRA_STEPS = [
  { id: 'codex', title: 'Codex', why: 'OpenAI\'s Codex on your own ChatGPT plan: it checks your clone\'s work, and your clone can hand it a whole job.' },
]
const ALL_STEPS = [...STEPS, ...EXTRA_STEPS]

// Steps a buyer may put off and come back to. Setup is "all set" only when every step is done or put off,
// and the dashboard shows what was put off.
// Backup can be put off too (clean-Mac run, Oct 17): a GitHub sign-up can be blocked for a while, and nothing after
// it needs GitHub. The dashboard keeps showing it as put off until it's done.
export const CAN_SKIP = new Set(['backup', 'voice', 'feed'])

// status: { [id]: true | false }, skipped: Set of ids. Returns the first step not done and not put off.
export function nextStep(status, skipped = new Set()) {
  return STEPS.find(s => !status[s.id] && !skipped.has(s.id)) || null
}

export function progress(status, skipped = new Set()) {
  const done = STEPS.filter(s => status[s.id]).length
  return { done, total: STEPS.length, skipped: STEPS.filter(s => !status[s.id] && skipped.has(s.id)).map(s => s.id) }
}

// Jon (Oct 17): some buyers already have a tool. Every step that needs an outside account offers both
// paths: "I already have one, here it is" or "sign me up for the free one you recommend".
const TWO_PATHS = 'Offer both paths: use what they already have, or the free one we recommend. '

// A tool the Tools step just installed isn't on this chat's search path yet (clean-Mac run, Oct 17), so Mac
// commands carry the folders Homebrew and the Intel installs use.
const MAC_PATH = 'PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH" '

// Codex installs with npm, which puts it next to whichever Node the Tools step found or installed.
const CODEX_PATH = 'PATH="$HOME/.youcloned/tools/node/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH" '

const q = (p) => '"' + String(p).replace(/(["\\$`])/g, '\\$1') + '"'

// What Claude does for one step. ctx: { root, home, folder, mac, defaultFolder, needsSkillKey, envFile, scratch, python, detail }
export function stepText(step, ctx) {
  const sh = (file, args = '') => ctx.mac
    ? '/bin/bash ' + q(ctx.root + '/setup/' + file + '.sh') + (args ? ' ' + args : '')
    : 'powershell -NoProfile -ExecutionPolicy Bypass -File ' + q(ctx.root + '\\setup\\' + file + '.ps1') + (args ? ' ' + args : '')
  switch (step.id) {
    case 'tools':
      return 'Run this with Bash and show the person each line it prints, in plain words: ' + sh('install-tools') + '. ' +
        'It skips what is already there. If it stops with exit code 3, something outside Claude needs one click first: on a Mac, Apple\'s developer tools box has opened behind the Claude window (tell them to click its icon in the Dock and press Install); on a PC, the Microsoft Store page for App Installer has opened (tell them to press Get or Update). Wait until they say it finished, then run the same command again. ' +
        'Homebrew may ask for their computer password in the command\'s output: tell them to type it where Claude shows the prompt, never in the chat. When it prints ALL TOOLS READY, call setup_next.'
    case 'home':
      return TWO_PATHS + 'Ask one short question: do you already have an Obsidian vault or a folder for your work you want your clone to live in, or should I make a new one? ' +
        'For a new one, offer ' + ctx.defaultFolder + ' (the same folder Jon\'s clone uses). For theirs, ask for its full path (in Obsidian: the vault switcher, then Reveal in Finder or Explorer). ' +
        'When they answer, call setup_next with folder set to the full path. YouCloned makes the folder if it isn\'t there and never moves or deletes what is already in it.'
    case 'protection':
      return 'Your chats are already guarded: YouCloned blocks a key going into a file or a command in every conversation. This step adds the same check to every save that goes to GitHub. ' +
        'Run with Bash: ' + (ctx.mac ? MAC_PATH : '') + 'node ' + q(ctx.root + (ctx.mac ? '/setup/guards/install-git-hooks.mjs' : '\\setup\\guards\\install-git-hooks.mjs')) + ' --install' +
        '. Tell them in one sentence what it did, then call setup_next.'
    case 'skillkey':
      return ctx.needsSkillKey + ' Walk them through it one click at a time and wait for each. Then call setup_next; a new connector can take up to a minute to show up, so if the step still shows not done, wait a moment and call setup_next again.'
    case 'interview':
      // Jon, Oct 17: every step works for someone who already has part of it. A buyer from the first YouCloned (or
      // anyone with notes about their business in this folder) never answers what their files already say.
      return 'Start the interview now: call load_setup and follow what it returns exactly, then save with save_setup. Leave folder out of save_setup: it is ' + ctx.folder + '. ' +
        'Before the first question, look in that folder for what they already wrote about themselves (a CLAUDE.md or YOUCLONED.md, an "about me" or business note, writing samples). If you find any, tell them in one sentence what you found, fill in every answer it already gives, and ask only what is missing; never delete or rewrite their CLAUDE.md. When save_setup says Saved, call setup_next.'
    case 'skills':
      return 'Run with Bash: ' + sh('install-skills') + '. It downloads Jon\'s starter skills pack from YouCloned, checks it, and puts each skill where Claude finds it. ' +
        'Tell them how many skills it installed. If it says it saved copies of skills they had changed, tell them which ones, that their copy is in ~/.youcloned/skills-backup, that the pack\'s newer version is the one in use now, and offer to put their change back into the new version. Then call setup_next.'
    case 'backup':
      return TWO_PATHS + 'Ask: do you already have a GitHub account (and maybe a private repository you want to use), or should I walk you through the free one I recommend? ' +
        'If they need one, have them sign up at github.com (free plan) and come back. If they already have a PRIVATE repository they want to use, add its address as the second argument to the command below; a public one is refused. ' +
        'Then run with Bash: ' + (ctx.mac ? MAC_PATH : '') + 'gh auth status. If it says they are not logged in, run: ' + (ctx.mac ? MAC_PATH : '') + 'gh auth login --web --git-protocol https --hostname github.com, and tell them a page opens with a code to paste (they can also open github.com/login/device on their phone). ' +
        'If GitHub won\'t let them sign up right now (it sometimes blocks new accounts for a while), call setup_next with skip set to backup and come back to it later. ' +
        'When gh is logged in, run with Bash: ' + sh('setup-backup', q(ctx.folder)) + ' (plus their repository address if they gave one). With no address it makes a PRIVATE repository, saves the folder there, and sets a nightly backup. ' +
        'It never makes a public one. When it prints BACKUP READY, call setup_next.'
    case 'library':
      return TWO_PATHS + 'Before anything else, ask this and wait for the answer: do you already have a Supabase account or project you want to use, or should I walk you through the free one I recommend? Either way the library goes in its own section, so nothing already in their project is touched. ' +
        'Then read ' + q(ctx.root + (ctx.mac ? '/library/setup.md' : '\\library\\setup.md')) + ' and follow it step by step. The env file is ' + ctx.envFile + '. ' +
        'It needs Supabase\'s connector in Claude. When its last check passes, call setup_next.'
    case 'voice': {
      // The voice setup asks questions and needs Claude closed for a moment, so it runs in its own Terminal
      // (PowerShell) window, never inside this chat (Codex review 1, Oct 17).
      const as = (x) => String(x).replace(/(["\\])/g, '\\$1')
      const open = ctx.mac
        ? "/usr/bin/osascript -e 'tell application \"Terminal\" to do script \"/bin/bash \\\"" + as(ctx.root + '/voice/setup-voice.sh') + "\\\"\"' -e 'tell application \"Terminal\" to activate'"
        : 'powershell -NoProfile -Command "Start-Process powershell -ArgumentList \'-NoExit\',\'-NoProfile\',\'-ExecutionPolicy\',\'Bypass\',\'-File\',\'\\\"' + String(ctx.root + '\\voice\\setup-voice.ps1').replace(/'/g, "''") + '\\\"\'"'
      return 'The voice setup runs in its own window because it asks two quick questions and needs Claude closed for a moment. Run this with Bash to open it: ' + open + '. ' +
        'Tell them, in two short sentences: a window opens and asks them to pick a man\'s or a woman\'s voice, then asks them to quit Claude (Command Q on a Mac); when it says the voice is ready, they open Claude again and type "finish my setup". ' +
        'Then stop and wait. If they want to do the voice later, call setup_next with skip set to voice.'
    }
    case 'feed': {
      const feed = ctx.root + (ctx.mac ? '/library/feed.py' : '\\library\\feed.py')
      return 'Use the youcloned:feed-me skill now. It tells them what to feed you first and has the librarian collect it. ' +
        'Give every helper these paths: FEED ' + q(feed) + ', ENV ' + q(ctx.envFile) + ', FOLDER ' + q(ctx.folder) + ', SCRATCH ' + q(ctx.scratch || '') +
        ', PYTHON ' + (ctx.mac ? q(ctx.python || 'python3') : 'py -3') + '. ' +
        'When at least one source is in the library, have the wiki writer write Library/index.md, then call setup_next. If they want to feed you later, call setup_next with skip set to feed.'
    }
    case 'codex': {
      // Codex signs in through the browser and waits for it, so the sign-in runs in its own window.
      const login = ctx.mac
        ? "/usr/bin/osascript -e 'tell application \"Terminal\" to do script \"" + CODEX_PATH.replace(/"/g, '\\"') + "codex login\"' -e 'tell application \"Terminal\" to activate'"
        : 'powershell -NoProfile -Command "Start-Process powershell -ArgumentList \'-NoExit\',\'-NoProfile\',\'-Command\',\'codex login\'"'
      return 'Codex is optional. Ask first, in one short question: do they have a ChatGPT plan (Plus or higher)? Codex runs on it and has no free version. If they don\'t, say in one sentence that it can wait and stop here. ' +
        (ctx.detail && ctx.detail.codex ? 'Codex is already installed (' + ctx.detail.codex + '), so skip the install. ' : 'Install it with Bash: ' + (ctx.mac ? CODEX_PATH : '') + 'npm install -g @openai/codex. ') +
        'Then open the sign-in in its own window with Bash: ' + login + '. Tell them, in two short sentences: a browser page opens, they sign in with ChatGPT, and when the window says they are logged in they come back and type "check Codex". ' +
        'Then stop and wait. When they come back, call setup_next with only set to codex.'
    }
    default:
      return ''
  }
}

// What each step needs first (Jon, Oct 17: "if you like your clone and you just want to add some things, do this").
export const NEEDS = {
  tools: [], home: [], protection: ['tools'], skillkey: [], interview: ['home', 'skillkey'], skills: [],
  backup: ['tools', 'home', 'protection'], library: ['tools', 'home'], voice: ['tools'], feed: ['library'], codex: ['tools'],
}

// One step on its own, for someone who likes their clone and wants to add just this.
export function onlyText(id, status, ctx) {
  const step = ALL_STEPS.find(s => s.id === id)
  if (!step) return 'There is no setup step called ' + id + '. The steps are: ' + ALL_STEPS.map(s => s.id).join(', ') + '.'
  if (status[id]) return step.title + ' is already set up on this computer, so there is nothing to add. Tell them that in one sentence.'
  const missing = (NEEDS[id] || []).filter(n => !status[n])
  if (missing.length) {
    const names = missing.map(n => ALL_STEPS.find(s => s.id === n).title).join(' and ')
    return step.title + ' needs ' + names + ' first. Tell them that in one sentence and offer to do ' + (missing.length > 1 ? 'those' : 'that') + ' first, then this. If they say yes, call setup_next with only set to ' + missing[0] + '.'
  }
  return 'Adding just one step, ' + step.title + ': ' + step.why + '\nTell them in one short sentence, then do it:\n' + stepText(step, ctx) +
    '\n\nWhen it is done, call setup_next with only set to ' + id + ' again to check it, and tell them it is added. Leave every other step as it is.'
}

export function setupText(status, skipped, ctx) {
  const p = progress(status, skipped)
  const next = nextStep(status, skipped)
  const list = STEPS.map((s, i) => (i + 1) + '. ' + s.title + ': ' + (status[s.id] ? 'done' : skipped.has(s.id) ? 'put off' : 'not yet') +
    (ctx.detail && ctx.detail[s.id] ? ' (' + ctx.detail[s.id] + ')' : '')).join('\n')
  if (!next) {
    return 'YouCloned setup: ' + p.done + ' of ' + p.total + ' steps done' + (p.skipped.length ? ', put off: ' + p.skipped.join(', ') : '') + '.\n' + list +
      '\n\nTell them they are all set, in one or two warm sentences, and what they can ask you to do first.' + (p.skipped.length ? ' Remind them they can say "finish my setup" any time to do what they put off.' : '')
  }
  const n = STEPS.indexOf(next) + 1
  return 'YouCloned setup: ' + p.done + ' of ' + p.total + ' steps done.\n' + list +
    '\n\nNext is step ' + n + ', ' + next.title + ': ' + next.why + '\n' +
    (p.done > 0 && p.done < p.total || Object.keys(ctx.detail || {}).length ? 'If this is the first setup_next of this chat, start by telling them in one or two sentences everything they already have: the steps marked done, and anything in brackets on the list above. Say you keep all of it, skip what is done, and only add what is missing.\n' : '') +
    'Tell them in one short sentence which step this is and why it matters, then do it:\n' + stepText(next, ctx) +
    '\n\nDo only this step now. Never skip ahead, and never call a step done yourself: setup_next checks it on this computer.'
}
