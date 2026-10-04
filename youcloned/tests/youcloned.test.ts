import { expect, mock, test } from 'claude-code/testing'
import { judge } from '../hooks/gate.js'
import { checkSetup } from '../hooks/rules.js'

const PROJECT = '/Users/pat/YouCloned'
const SAMPLE = 'Hey friend, '.repeat(40)
const SETUP = {
  name: 'Pat Doe', business: 'Garden coaching', offers: 'Backyard Garden Course, $97', audience: 'New gardeners',
  voice: 'Warm, short sentences', brand: 'Green and cream', accounts: 'Gmail, Kajabi', voice_samples: [SAMPLE, SAMPLE],
}

const PANE = {
  plugin: 'youcloned', component: 'Pane', requestId: 'youcloned', viewport: { columns: 140, rows: 40 },
  props: { title: 'YouCloned', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

// Stubs for everything session.start touches, with the project already set up.
// SkillKey as the desktop app names it (an id) unless a test says otherwise.
const SK = '4a62845f-77ec-431f-8b76-2d42902a60fb'
const skTools = (server = SK) => ['list_skills', 'start_skill', 'run_skill', 'word_balance'].map(t => ({ name: 'mcp__' + server + '__' + t, description: '', mcp: true }))
const fromSk = (body: string) => ({ content: [{ type: 'text', text: 'You are short on words.\n\n<<<YOUCLONED>>>\n' + body + '\n<<<END YOUCLONED>>>\n\nWhen you have everything the steps ask for, call run_skill with skill "x".' }], isError: false })

function sessionStubs(on, opts: { project?: string, agents?: unknown[], files?: Record<string, string>, process?: (argv: string[]) => unknown, toasts?: string[], lists?: Record<string, string[]>, cwd?: string, skillKey?: string | null, mcpCalls?: { server: string, tool: string, args: Record<string, unknown> }[], registered?: { name: string, prompt: string }[], owns?: (slug: string) => boolean, opened?: string[], browser?: string[] } = {}) {
  const writes = new Map<string, string>()
  const store = new Map<string, unknown>(opts.project ? [['project', opts.project]] : [])
  const clock = mock.clock(on)
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/pat' : undefined }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('fs.exists', ($, e) => ({ value: e.path in (opts.files || {}) || e.path.endsWith('/skills') }))
  on('fs.list', ($, e) => ({ value: e.path.endsWith('/skills') ? [{ name: 'setup', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }, { name: 'notes.txt', kind: 'file', size: 1, mtimeMs: 0, isLink: false }]
    : (opts.lists?.[e.path] || []).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }))
  on('fs.read', ($, e) => ({ value: (opts.files || {})[e.path] ?? (e.path.endsWith('SKILL.md') ? 'description: Set up YouCloned. More.' : 'crew prompt') }))
  on('fs.write', ($, e) => { writes.set(e.path, e.text); return { value: undefined } })
  const sk = opts.skillKey === undefined ? SK : opts.skillKey
  on('tool.list', () => ({ value: sk ? skTools(sk) : [] }))
  on('mcp.call', ($, e) => {
    opts.mcpCalls?.push(e)
    if (opts.browser && e.server === 'Claude_Browser') { opts.browser.push(e.tool + ' ' + JSON.stringify(e.args)); return { value: { content: [{ type: 'text', text: 'ok' }], isError: false } } }
    if (!sk || (e.server !== sk && e.server !== 'claude.ai SkillKey')) throw new Error('no such server')
    if (e.tool === 'list_skills') return { value: { content: [{ type: 'text', text: '- AI Revenue Plan (skill: "ai-revenue-plan"): A one-page 12-month plan\n- YouCloned Setup (skill: "youcloned-setup"): Sets up your clone\n\nWords left: 4,200' }], isError: false } }
    if (e.tool === 'word_balance') return { value: { content: [{ type: 'text', text: 'Words left: 4,200' }], isError: false } }
    if (e.tool === 'start_skill') return { value: (opts.owns || (() => true))(String(e.args.skill)) ? fromSk('Instructions for ' + e.args.skill) : { content: [{ type: 'text', text: 'That skill is not on this account. Call list_skills to see the skills this person has.' }], isError: false } }
    return { value: { content: [], isError: true } }
  })
  on('tool.register', () => ({ value: undefined }))
  on('agent.register', ($, e) => { opts.registered?.push({ name: e.name, prompt: e.prompt }); return { value: { agent: 'youcloned:' + e.name } } })
  on('agent.list', () => ({ value: opts.agents || [] }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', ($, e) => { opts.opened?.push(e.id); return { value: { isPlaced: true } } })
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($, e) => { opts.toasts?.push(e.text); return { value: undefined } })
  on('session.start', () => ({ cwd: opts.cwd || '/work' }))
  on('session.cwd', () => ({ value: opts.cwd || '/work' }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'I wrote copy/letter.md', toolUses: [] }] }))
  on('process.run', ($, e) => ({ value: opts.process ? opts.process(e.argv) : { exitCode: 1, stdout: '', stderr: '' } }))
  on('tool.call', () => ({ result: 'ran' }))
  return { writes, store, clock }
}

test('gate: crew reads anything and writes only inside its folder', () => {
  const dir = PROJECT + '/crew/support'
  expect(judge({ tool: 'Read', file_path: '/etc/hosts' }, dir)).toBe(null)
  expect(judge({ tool: 'Write', file_path: dir + '/drafts/a.md' }, dir)).toBe(null)
  expect(judge({ tool: 'Write', file_path: dir + '/../inbox/a.md' }, dir)).toMatch(/outside/)
  expect(judge({ tool: 'Write', file_path: '/Users/pat/.zshrc' }, dir)).toMatch(/outside/)
  expect(judge({ tool: 'Write', file_path: 'drafts/a.md' }, dir)).toMatch(/outside/)
  expect(judge({ tool: 'Bash', command: 'ls' }, dir)).toMatch(/not on the crew/)
  expect(judge({ tool: 'Edit', file_path: dir + '/drafts/a.md' }, dir)).toMatch(/not on the crew/)
})

test('gate: connector look-ups pass, sends and changes are refused', () => {
  const dir = PROJECT + '/crew/inbox'
  expect(judge({ tool: 'mcp__claude_ai_Gmail__search_threads' }, dir)).toBe(null)
  expect(judge({ tool: 'mcp__claude_ai_Gmail__get_thread' }, dir)).toBe(null)
  expect(judge({ tool: 'mcp__circle__listPosts' }, dir)).toBe(null)
  expect(judge({ tool: 'mcp__drive__GetFileContents' }, dir)).toBe(null)
  for (const t of ['send_message', 'create_draft', 'reply', 'trash_thread', 'label_thread', 'refund', 'post_comment', 'getaway_send', 'getAndSend', 'search_and_delete', 'read_then_archive', 'listen']) {
    expect(judge({ tool: 'mcp__x__' + t }, dir)).toMatch(/only look-up/)
  }
})

test('gate: Windows paths are judged the same way', () => {
  const dir = 'C:\\Users\\pat\\YouCloned\\crew\\support'
  expect(judge({ tool: 'Write', file_path: 'C:\\Users\\pat\\YouCloned\\crew\\support\\drafts\\a.md' }, dir)).toBe(null)
  expect(judge({ tool: 'Write', file_path: 'C:\\Users\\pat\\Desktop\\a.md' }, dir)).toMatch(/outside/)
})

test('setup: refuses empty sections and made-up or missing samples', () => {
  expect(checkSetup(SETUP)).toEqual([])
  expect(checkSetup({ ...SETUP, offers: ' ' }).join()).toMatch(/What I sell/)
  expect(checkSetup({ ...SETUP, voice_samples: [SAMPLE, 'short'] }).join()).toMatch(/at least 2/)
  expect(checkSetup({ ...SETUP, voice_samples: undefined }).join()).toMatch(/got 0/)
})

test('save_setup writes the rules file and crew folders, and refuses a bad setup', async ($, on) => {
  const { writes, store } = sessionStubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const bad = await $.tool.call({ tool: 'mcp__youcloned__save_setup', ...SETUP, voice_samples: [SAMPLE] })
  expect(bad.result).toMatch(/^Not saved/)
  expect(writes.size).toBe(0)
  const ok = await $.tool.call({ tool: 'mcp__youcloned__save_setup', ...SETUP })
  expect(ok.result).toMatch(/^Saved/)
  expect(writes.get(PROJECT + '/YOUCLONED.md')).toMatch(/## What I sell\n\nBackyard Garden Course/)
  expect(writes.has(PROJECT + '/crew/support/inbox/.keep')).toBe(true)
  expect(writes.has(PROJECT + '/crew/inbox/drafts/.keep')).toBe(true)
  expect(store.get('project')).toBe(PROJECT)
})

test('the gate refuses a crew member writing outside its folder, and lets everyone else through', async ($, on) => {
  sessionStubs(on, { project: PROJECT, agents: [{ id: 'a1', type: 'youcloned:support', description: '', status: 'running' }, { id: 'b2', type: 'general-purpose', description: '', status: 'running' }] })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const out = await $.tool.call({ tool: 'Write', file_path: '/Users/pat/Desktop/x.md', content: 'x', agentId: 'a1' })
  expect(out.deny).toMatch(/safety gate refused/)
  const sent = await $.tool.call({ tool: 'mcp__claude_ai_Gmail__send_message', agentId: 'a1' })
  expect(sent.deny).toMatch(/only look-up/)
  const draft = await $.tool.call({ tool: 'Write', file_path: PROJECT + '/crew/support/drafts/a.md', content: 'x', agentId: 'a1' })
  expect(draft.result).toBe('ran')
  const other = await $.tool.call({ tool: 'Write', file_path: '/Users/pat/Desktop/x.md', content: 'x', agentId: 'b2' })
  expect(other.result).toBe('ran')
  const main = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(main.result).toBe('ran')
})

test('every conversation in the clone folder gets the rules file', async ($, on) => {
  sessionStubs(on, { project: PROJECT, cwd: PROJECT, files: { [PROJECT + '/YOUCLONED.md']: '# My YouCloned rules\nPat' } })
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const out = await $.prompt.context({ blocks: [{ name: 'currentDate', text: 'today' }] })
  expect(out.blocks.length).toBe(2)
  expect(out.blocks[1].text).toMatch(/My YouCloned rules\nPat/)
})

test('a conversation outside the clone folder gets no rules and no YouCloned strip', async ($, on) => {
  sessionStubs(on, { project: PROJECT, files: { [PROJECT + '/YOUCLONED.md']: '# My YouCloned rules\nPat' } })
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const out = await $.prompt.context({ blocks: [{ name: 'currentDate', text: 'today' }] })
  expect(out.blocks.length).toBe(1)
})

test('/youcloned codex runs Codex read-only and returns its answer', async ($, on) => {
  const calls: string[][] = []
  sessionStubs(on, {
    project: PROJECT,
    process: (argv) => {
      calls.push(argv)
      if (argv[0] === 'codex') return { exitCode: 0, stdout: 'codex-cli 1.0', stderr: '' }
      if (argv[0] === 'git') return { exitCode: 128, stdout: '', stderr: 'not a git repository' }
      return { exitCode: 0, stdout: '', stderr: '' }
    },
    files: { '/Users/pat/.youcloned/codex-last.md': 'Line 3 of copy/letter.md promises a refund the offer does not have.' },
  })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const out = await $.command.run({ command: 'youcloned', args: 'codex' })
  expect(out.text).toMatch(/promises a refund/)
  const exec = calls.find(a => a[1] === 'exec')
  expect(exec).toBeDefined()
  expect(exec.slice(0, 4)).toEqual(['codex', 'exec', '--sandbox', 'read-only'])
  expect(exec[exec.length - 1]).toMatch(/I wrote copy\/letter.md/)
})

test('/youcloned codex says how to get Codex when it is missing', async ($, on) => {
  sessionStubs(on, { project: PROJECT })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const out = await $.command.run({ command: 'youcloned', args: 'codex' })
  expect(out.text).toMatch(/Codex is not installed/)
})

test('the pane draws every tab in the terminal and the desktop app', async ($, on) => {
  sessionStubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-home' })
    expect(await ui.find({ key: 'home-job-vsl-lead-writer' })).toBeDefined()
    expect(await ui.find({ key: 'home-all' })).toBeDefined()
    expect(await ui.find({ key: 'home-dash' })).toBeDefined()
    await ui.press({ key: 'tab-skills' })
    expect(await ui.find({ key: 'skill-sales-letter' })).toBeDefined()
    expect(await ui.find({ key: 'pin-sales-letter' })).toBeDefined()
    await ui.press({ key: 'tab-crew' })
    expect(await ui.find({ key: 'run-support' })).toBeDefined()
    expect(await ui.find({ key: 'every-inbox' })).toBeDefined()
    await ui.press({ key: 'tab-money' })
    expect(await ui.find({ type: 'Text', text: /These numbers are a sample/ })).toBeDefined()
    await ui.press({ key: 'tab-setup' })
    expect(await ui.find({ key: 'setup' })).toBeDefined()
    expect(await ui.find({ key: 'codex' })).toBeDefined()
    await ui.unmount()
  }
})

test('Run now without setup tells the customer to set up first', async ($, on) => {
  const toasts: string[] = []
  sessionStubs(on, { toasts })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-crew' })
  await ui.press({ key: 'run-support' })
  expect(toasts[0]).toMatch(/Set up YouCloned first/)
})

test('a crew call the gate allows is approved without a question; a denied rule still wins', async ($, on) => {
  sessionStubs(on, { project: PROJECT, agents: [{ id: 'a1', type: 'youcloned:inbox', description: '', status: 'running' }] })
  let core = 'ask'
  on('tool.check', () => ({ decision: core }))
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  await $.tool.call({ tool: 'mcp__claude_ai_Gmail__search_threads', tool_use_id: 'u1', agentId: 'a1' })
  expect((await $.tool.check({ tool: 'mcp__claude_ai_Gmail__search_threads', input: {}, tool_use_id: 'u1' })).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'mcp__claude_ai_Gmail__search_threads', input: {}, tool_use_id: 'u9' })).decision).toBe('ask')
  core = 'deny'
  await $.tool.call({ tool: 'mcp__claude_ai_Gmail__search_threads', tool_use_id: 'u2', agentId: 'a1' })
  expect((await $.tool.check({ tool: 'mcp__claude_ai_Gmail__search_threads', input: {}, tool_use_id: 'u2' })).decision).toBe('deny')
})

test('the support crew gets only the questions that have no draft yet', async ($, on) => {
  const dir = PROJECT + '/crew/support'
  const spawned: string[] = []
  sessionStubs(on, {
    project: PROJECT,
    files: { [dir + '/inbox']: '', [dir + '/drafts']: '', [dir + '/drafts/a.md']: 'Question: maria.txt\nCustomer: Maria\n\nHi' },
    lists: { [dir + '/inbox']: ['maria.txt', 'tom.txt', '.keep'], [dir + '/drafts']: ['a.md'] },
  })
  on('agent.spawn', ($, e) => { spawned.push(e.prompt); return { agentId: 'a1', model: 'x' } })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  await $.command.run({ command: 'youcloned', args: 'crew support' })
  expect(spawned[0]).toMatch(/inbox\/tom\.txt/)
  expect(spawned[0]).not.toMatch(/maria\.txt/)
})

test('after setup YouCloned shows everywhere; /youcloned off and on switch it', async ($, on) => {
  const { store } = sessionStubs(on, { project: PROJECT })
  store.set('everywhere', true)
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const off = await $.command.run({ command: 'youcloned', args: 'off' })
  expect(off.text).toMatch(/off in your other sessions/)
  expect(store.get('everywhere')).toBe(false)
  const back = await $.command.run({ command: 'youcloned', args: 'on' })
  expect(back.text).toMatch(/on in every Claude session/)
  expect(store.get('everywhere')).toBe(true)
})

test('crew instructions come from SkillKey, never from a file in the add-on', async ($, on) => {
  const registered: { name: string, prompt: string }[] = []
  const mcpCalls: { server: string, tool: string, args: Record<string, unknown> }[] = []
  sessionStubs(on, { project: PROJECT, cwd: PROJECT, files: { [PROJECT + '/YOUCLONED.md']: '# rules' }, registered, mcpCalls })
  await $.session.start({ surface: 'desktop', isInteractive: false, cwd: PROJECT })
  expect(registered.map(r => r.name).sort()).toEqual(['inbox', 'support'])
  expect(registered.find(r => r.name === 'support').prompt).toBe('Instructions for youcloned-crew-support')
  expect(mcpCalls.every(c => c.server === SK)).toBe(true)
})

test('without SkillKey the crew does not start and says how to connect it', async ($, on) => {
  const registered: { name: string, prompt: string }[] = []
  sessionStubs(on, { project: PROJECT, cwd: PROJECT, files: { [PROJECT + '/YOUCLONED.md']: '# rules' }, skillKey: null, registered })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: PROJECT })
  expect(registered.length).toBe(0)
  const out = await $.command.run({ command: 'youcloned', args: 'crew inbox' })
  expect(out.text).toMatch(/SkillKey is not connected/)
})

test('load_setup hands Claude the setup interview from SkillKey, markers and SkillKey notes removed', async ($, on) => {
  sessionStubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const out = await $.tool.call({ tool: 'mcp__youcloned__load_setup' })
  expect(out.result).toBe('Instructions for youcloned-setup')
})

test('SkillKey is found in the terminal by its usual name too', async ($, on) => {
  const mcpCalls: { server: string, tool: string, args: Record<string, unknown> }[] = []
  sessionStubs(on, { skillKey: 'claude_ai_SkillKey', mcpCalls })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const out = await $.tool.call({ tool: 'mcp__youcloned__load_setup' })
  expect(mcpCalls[0].server).toBe('claude_ai_SkillKey')
  expect(out.result).toBe('Instructions for youcloned-setup')
})

test('the desktop panel pictures fill the panel: no fixed size, drawn wider than any panel', async ($, on) => {
  sessionStubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-home' })
  const pics = await ui.findAll({ type: 'Svg' })
  expect(pics.length).toBe(6)
  for (const p of pics) {
    expect(p.props.width).toBeUndefined()
    expect(p.props.source).toMatch(/^<svg[^>]* width="2400"/)
  }
  await ui.unmount()
})

test('the desktop Home tab is the full dashboard: logo bar, greeting, money (marked Sample), crew, apps, newest video', async ($, on) => {
  sessionStubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-home' })
  const alts = (await ui.findAll({ type: 'Svg' })).map(p => String(p.props.alt))
  expect(alts[0]).toBe('YouCloned')
  expect(alts.some(a => /Made or saved this week \(sample\)/.test(a))).toBe(true)
  const money = (await ui.findAll({ type: 'Svg' })).find(p => /Made or saved/.test(String(p.props.alt)))
  expect(money.props.source).toMatch(/>Sample</)
  expect(alts.some(a => a.startsWith('New from Jon'))).toBe(true)
  expect(await ui.find({ key: 'home-new' })).toBeDefined()
  await ui.unmount()
})

test('a helper the SkillKey account does not own stays off and says it comes with Pro', async ($, on) => {
  const registered: { name: string, prompt: string }[] = []
  sessionStubs(on, { project: PROJECT, cwd: PROJECT, files: { [PROJECT + '/YOUCLONED.md']: '# rules' }, registered, owns: (slug) => slug !== 'youcloned-crew-inbox' })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: PROJECT })
  expect(registered.map(r => r.name)).toEqual(['support'])
  const out = await $.command.run({ command: 'youcloned', args: 'crew inbox' })
  expect(out.text).toMatch(/comes with YouCloned Pro/)
})

test('the YouCloned panel opens itself on the Home tab when a session starts in the clone folder', async ($, on) => {
  const opened: string[] = []
  const { clock } = sessionStubs(on, { project: PROJECT, cwd: PROJECT, files: { [PROJECT + '/YOUCLONED.md']: '# rules' }, opened })
  on('http.fetch', () => ({ value: { status: 200, headers: {}, text: '{}' } }))
  await $.session.start({ surface: 'desktop', isInteractive: false, cwd: PROJECT })
  await clock.advance(2000)
  expect(opened).toContain('youcloned')
})

test('no tab, job or skill button carries a keyboard letter or number', async ($, on) => {
  sessionStubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const t of ['home', 'skills', 'crew', 'money', 'setup']) {
    await ui.press({ key: 'tab-' + t })
    for (const b of await ui.findAll({ type: 'Button' })) expect(b.props.hotkey).toBeUndefined()
  }
  await ui.unmount()
})

test('Skills lists the SkillKey skills the account owns, finds by word, and pins to the Dashboard', async ($, on) => {
  const { clock, store } = sessionStubs(on, { skillKey: 'claude_ai_SkillKey' })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-skills' })
  expect(await ui.find({ key: 'skill-ai-revenue-plan' })).toBeDefined()
  expect(await ui.findAll({ key: 'skill-youcloned-setup' })).toHaveLength(0)
  await ui.press({ key: 'pin-ai-revenue-plan' })
  expect(store.get('pins')).toContain('ai-revenue-plan')
  await ui.press({ key: 'tab-home' })
  expect(await ui.find({ key: 'home-job-ai-revenue-plan' })).toBeDefined()
  await ui.press({ key: 'tab-skills' })
  await ui.input({ key: 'skill-search', text: 'revenue', submit: true })
  expect(await ui.find({ key: 'skill-ai-revenue-plan' })).toBeDefined()
  expect(await ui.findAll({ key: 'skill-sales-letter' })).toHaveLength(0)
  await ui.unmount()
})

test('the drawings follow the panel width so text keeps its size', async ($, on) => {
  sessionStubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { title: 'YouCloned', bodyColumns: 140 } })
  await ui.press({ key: 'tab-home' })
  const top = (await ui.findAll({ type: 'Svg' }))[0]
  expect(top.props.source).toMatch(/viewBox="0 0 1176 /)
  await ui.unmount()
})

test('a pressed skill says it is starting and its job reaches the chat on the next tick', async ($, on) => {
  const toasts: string[] = []
  const submitted: string[] = []
  const { clock } = sessionStubs(on, { toasts })
  on('prompt.submit', ($, e) => { submitted.push(String(e.text)); return { value: undefined } })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-skills' })
  await ui.press({ key: 'skill-sales-letter' })
  expect(toasts).toContain('Starting Sales letter…')
  await clock.advance(10)
  expect(submitted.some(t => t.startsWith('Write a sales letter'))).toBe(true)
  await ui.unmount()
})

test('in the desktop app the full dashboard loads into the browser pane and the small panel stays shut', async ($, on) => {
  const opened: string[] = []
  const browser: string[] = []
  const { clock } = sessionStubs(on, { project: PROJECT, cwd: PROJECT, files: { [PROJECT + '/YOUCLONED.md']: '# rules' }, opened, browser })
  on('http.fetch', () => ({ value: { status: 200, headers: {}, text: '{}' } }))
  await $.session.start({ surface: 'desktop', isInteractive: false, cwd: PROJECT })
  await clock.advance(2000)
  expect(browser[0]).toBe('preview_start {"name":"YouCloned"}')
  expect(browser[1]).toMatch(/preview_start \{"url":"http:\/\/127\.0\.0\.1:4600\/"\}/)
  expect(opened).not.toContain('youcloned')
})
