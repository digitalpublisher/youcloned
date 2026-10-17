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

// Steps a buyer may put off and come back to. Setup is "all set" only when every step is done or put off,
// and the dashboard shows what was put off.
export const CAN_SKIP = new Set(['voice', 'feed'])

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
        'Run with Bash: node ' + q(ctx.root + (ctx.mac ? '/setup/guards/install-git-hooks.mjs' : '\\setup\\guards\\install-git-hooks.mjs')) + ' --install' +
        '. Tell them in one sentence what it did, then call setup_next.'
    case 'skillkey':
      return ctx.needsSkillKey + ' Walk them through it one click at a time and wait for each. Then call setup_next; a new connector can take up to a minute to show up, so if the step still shows not done, wait a moment and call setup_next again.'
    case 'interview':
      return 'Start the interview now: call load_setup and follow what it returns exactly, then save with save_setup. Leave folder out of save_setup: it is ' + ctx.folder + '. When save_setup says Saved, call setup_next.'
    case 'skills':
      return 'Run with Bash: ' + sh('install-skills') + '. It downloads Jon\'s starter skills pack from YouCloned, checks it, and puts each skill where Claude finds it. ' +
        'Tell them how many skills it installed, then call setup_next.'
    case 'backup':
      return TWO_PATHS + 'Ask: do you already have a GitHub account (and maybe a private repository you want to use), or should I walk you through the free one I recommend? ' +
        'If they need one, have them sign up at github.com (free plan) and come back. If they already have a PRIVATE repository they want to use, add its address as the second argument to the command below; a public one is refused. ' +
        'Then run with Bash: gh auth status. If it says they are not logged in, run: gh auth login --web --git-protocol https --hostname github.com, and tell them a browser page opens with a code to paste. ' +
        'When gh is logged in, run with Bash: ' + sh('setup-backup', q(ctx.folder)) + ' (plus their repository address if they gave one). With no address it makes a PRIVATE repository, saves the folder there, and sets a nightly backup. ' +
        'It never makes a public one. When it prints BACKUP READY, call setup_next.'
    case 'library':
      return TWO_PATHS + 'Ask: do you already have a Supabase account or project you want to use, or should I walk you through the free one I recommend? Either way the library goes in its own section, so nothing already in their project is touched. ' +
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
    default:
      return ''
  }
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
    'Tell them in one short sentence which step this is and why it matters, then do it:\n' + stepText(next, ctx) +
    '\n\nDo only this step now. Never skip ahead, and never call a step done yourself: setup_next checks it on this computer.'
}
