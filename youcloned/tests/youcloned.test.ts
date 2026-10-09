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

function sessionStubs(on, opts: { project?: string, agents?: unknown[], files?: Record<string, string>, process?: (argv: string[]) => unknown, toasts?: string[], lists?: Record<string, string[]>, cwd?: string, skillKey?: string | null, mcpCalls?: { server: string, tool: string, args: Record<string, unknown> }[], registered?: { name: string, prompt: string }[], owns?: (slug: string) => boolean, opened?: string[], browser?: string[], toolCall?: (e: any) => void, read?: (path: string) => string | undefined, exists?: (path: string) => boolean | undefined, mcpThrow?: string } = {}) {
  const writes = new Map<string, string>()
  const store = new Map<string, unknown>(opts.project ? [['project', opts.project]] : [])
  const clock = mock.clock(on)
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/pat' : undefined }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('fs.exists', ($, e) => ({ value: opts.exists?.(e.path) ?? (e.path in (opts.files || {}) || e.path.endsWith('/skills')) }))
  on('fs.list', ($, e) => ({ value: e.path.endsWith('/skills') ? [{ name: 'setup', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }, { name: 'notes.txt', kind: 'file', size: 1, mtimeMs: 0, isLink: false }]
    : (opts.lists?.[e.path] || []).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }))
  on('fs.read', ($, e) => ({ value: opts.read?.(e.path) ?? (opts.files || {})[e.path] ?? (e.path.endsWith('SKILL.md') ? 'description: Set up YouCloned. More.' : 'crew prompt') }))
  on('fs.write', ($, e) => { writes.set(e.path, e.text); return { value: undefined } })
  const sk = opts.skillKey === undefined ? SK : opts.skillKey
  on('tool.list', () => ({ value: sk ? skTools(sk) : [] }))
  on('mcp.call', ($, e) => {
    opts.mcpCalls?.push(e)
    if (opts.mcpThrow) return { value: { content: [{ type: 'text', text: 'YouCloned MCP call: ' + opts.mcpThrow }], isError: true } }
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
  on('tool.call', ($, e) => { opts.toolCall?.(e); return { result: 'ran' } })
  on('session.id', () => ({ value: 'sess-1' }))
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
    if (surface === 'terminal') expect(await ui.find({ key: 'home-dash' })).toBeDefined()
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
  expect(out.text).toMatch(/SkillKey isn't connected/)
  expect(out.text).toMatch(/skills\.bnsn\.ai\/gifts\/install/)
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

test('the desktop panel pictures: full-width cards have no fixed size, logos and the thumbnail have theirs', async ($, on) => {
  sessionStubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-home' })
  const pics = await ui.findAll({ type: 'Svg' })
  const sized = pics.filter(p => p.props.width !== undefined)
  expect(sized.length).toBe(8)
  for (const p of pics.filter(p => p.props.width === undefined)) expect(p.props.source).toMatch(/^<svg[^>]* width="2400"/)
  const total = pics.reduce((n, p) => n + String(p.props.source).length, 0)
  expect(total).toBeLessThan(140000)
  await ui.unmount()
})

test('the desktop Dashboard: greeting, job card, money (Sample), crew with its buttons, apps with theirs, newest video', async ($, on) => {
  sessionStubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-home' })
  const alts = (await ui.findAll({ type: 'Svg' })).map(p => String(p.props.alt))
  expect(alts[0]).toBe('YouCloned')
  for (const a of ['Start a job', 'Your crew', 'Your BNSN apps', 'New from Jon']) expect(alts).toContain(a)
  const money = (await ui.findAll({ type: 'Svg' })).find(p => /Made or saved/.test(String(p.props.alt)))
  expect(money.props.source).toMatch(/>Sample</)
  expect(await ui.find({ key: 'home-job-vsl-lead-writer' })).toBeDefined()
  expect(await ui.find({ key: 'home-run-support' })).toBeDefined()
  expect(await ui.find({ key: 'home-new' })).toBeDefined()
  const links = (await ui.findAll({ type: 'Link' })).map(l => String(l.props.href))
  expect(links).toContain('https://app.bnsn.ai')
  expect(links).toContain('https://www.youtube.com/watch?v=j058ugnLtUE')
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
  on('prompt.submit', ($, e) => { submitted.push(String(e.text)); return { text: String(e.text) } })
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
  expect(browser[1]).toMatch(/preview_start \{"url":"http:\/\/localhost:4600\/"\}/)
  expect(opened).not.toContain('youcloned')
})

test('Talk to Isaac sends the talk message to this session through the voice relay', async ($, on) => {
  const toasts: string[] = []
  const posts: { url: string, body: string }[] = []
  sessionStubs(on, { toasts })
  on('http.fetch', ($, e) => { if (e.init?.method === 'POST') posts.push({ url: e.url, body: String(e.init.body) }); return { value: { status: 200, ok: true, headers: {}, text: '{}' } } })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-home' })
  await ui.post({ key: 'talk', data: { talk: true } })
  await ui.unmount()
  expect(posts[0].url).toBe('http://127.0.0.1:8771/say')
  expect(JSON.parse(posts[0].body)).toEqual({ session: 'sess-1', text: expect.stringMatching(/call converse/) })
  expect(toasts).toContain('Isaac is listening')
})

test('while Isaac is in a voice conversation the dashboard state says listening, and stops after', async ($, on) => {
  let during: any = null
  const { writes } = sessionStubs(on, { toolCall: () => { during = JSON.parse(writes.get('/Users/pat/.youcloned/state.json') || '{}') } })
  await $.session.start({ surface: 'desktop', isInteractive: false, cwd: '/work' })
  await $.tool.call({ tool: 'mcp__plugin_voicemode_voicemode__converse', input: { message: 'hi' } })
  expect(during.listening).toBe(true)
  expect(during.session).toBe('sess-1')
  expect(JSON.parse(writes.get('/Users/pat/.youcloned/state.json') || '{}').listening).toBe(false)
})

test('pressing Talk again while Isaac listens stops the voice conversation and tells Isaac why', async ($, on) => {
  const toasts: string[] = []
  const posts: string[] = []
  on('tool.call', { tool: 'mcp__plugin_voicemode_voicemode__converse' }, () => new Promise(() => {}))
  const { clock } = sessionStubs(on, { toasts })
  on('http.fetch', ($, e) => { if (e.init?.method === 'POST') posts.push(e.url); return { value: { status: 200, ok: true, headers: {}, text: '{}' } } })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-home' })
  const call = $.tool.call({ tool: 'mcp__plugin_voicemode_voicemode__converse', input: { message: 'hi' } })
  await clock.advance(1)
  await ui.post({ key: 'talk', data: { talk: true } })
  const r: any = await call
  await ui.unmount()
  expect(String(r.deny || r.text)).toMatch(/pressed Talk again/)
  expect(toasts).toContain('Isaac stopped')
  expect(posts).toEqual([])
})

test('New project asks Claude to file this session in a sidebar group of its own', async ($, on) => {
  const submitted: string[] = []
  const { clock } = sessionStubs(on)
  on('prompt.submit', ($, e) => { submitted.push(String(e.text)); return { text: String(e.text) } })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-home' })
  await ui.press({ key: 'home-new-project' })
  await clock.advance(10)
  await ui.unmount()
  expect(submitted.some(t => /sidebar group/.test(t) && /move this session/.test(t))).toBe(true)
})

test('the plan gauge shows the tightest limit: a nearly spent week beats a fresh 5 hours', async ($, on) => {
  const { writes, clock } = sessionStubs(on, { project: PROJECT, cwd: PROJECT, files: { [PROJECT + '/YOUCLONED.md']: '# rules' } })
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))
  on('session.usage', () => ({ value: { rateLimits: [
    { kind: 'five_hour', percentUsed: 10, resetsAt: '2026-10-05T18:50:00Z' },
    { kind: 'seven_day', percentUsed: 86, resetsAt: '2026-10-06T12:00:00Z' },
  ] } }))
  await $.session.start({ surface: 'desktop', isInteractive: false, cwd: PROJECT })
  await clock.advance(2000)
  const st = JSON.parse(writes.get('/Users/pat/.youcloned/state.json') || '{}')
  expect(st.claudePct).toBe(86)
  expect(st.claudeSpan).toBe('Weekly plan')
  expect(st.claudeLabel).toMatch(/this week · resets/)
})

test('on a Mac the dashboard runs as a background service and launch.json opens its address', async ($, on) => {
  const argvs: string[][] = []
  const { writes, clock } = sessionStubs(on, { project: PROJECT, cwd: PROJECT, files: { [PROJECT + '/YOUCLONED.md']: '# rules' },
    exists: (path) => path === '/usr/bin/python3' || undefined,
    process: (argv) => { argvs.push(argv); return { exitCode: 0, stdout: argv[0] === '/usr/bin/id' ? '501\n' : '', stderr: '' } } })
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))
  await $.session.start({ surface: 'desktop', isInteractive: false, cwd: PROJECT })
  await clock.advance(2000)
  const plist = writes.get('/Users/pat/Library/LaunchAgents/ai.bnsn.youcloned.dashboard.plist') || ''
  expect(plist).toMatch(/\/Users\/pat\/\.youcloned\/dashboard\/server\.py/)
  expect(plist).toMatch(/<key>KeepAlive<\/key><true\/>/)
  expect(plist).toContain('<string>/usr/bin/python3</string>')
  expect(argvs.some(a => a[0] === '/bin/launchctl' && a[1] === 'bootstrap' && a[2] === 'gui/501')).toBe(true)
  const launch = JSON.parse(writes.get(PROJECT + '/.claude/launch.json') || '{}')
  expect(launch.configurations).toContainEqual({ name: 'YouCloned', url: 'http://localhost:4600' })
})

test('only a desktop session names itself for the dashboard talk button; other chats keep its name', async ($, on) => {
  const { writes } = sessionStubs(on, { read: (path) => writes.get(path) ?? (path.endsWith('state.json') ? JSON.stringify({ session: 'desk-1', listening: false }) : undefined) })
  await $.session.start({ surface: 'vscode', isInteractive: true, cwd: '/work' })
  await $.tool.call({ tool: 'mcp__plugin_voicemode_voicemode__converse', input: { message: 'hi' } })
  expect(JSON.parse(writes.get('/Users/pat/.youcloned/state.json') || '{}').session).toBe('desk-1')
})

test('words come only from SkillKey\'s "Words left" line, never from another number in the reply', async ($, on) => {
  const { writes, clock } = sessionStubs(on, { project: PROJECT, cwd: PROJECT, files: { [PROJECT + '/YOUCLONED.md']: '# rules' } })
  on('http.fetch', () => ({ value: { status: 404, ok: false, headers: {}, text: '' } }))
  await $.session.start({ surface: 'desktop', isInteractive: false, cwd: PROJECT })
  await clock.advance(3000)
  expect(JSON.parse(writes.get('/Users/pat/.youcloned/state.json') || '{}').words).toBe(4200)
})

test('the New from Jon card shows the online feed, and the saved copy when offline', async ($, on) => {
  const feed = JSON.stringify({ items: [{ id: 'oms-1', title: 'Over My Shoulder: the new crew', note: 'Watch the crew work.', button: 'Show me the crew', job: 'Show me my crew.', watch: 'https://www.youtube.com/watch?v=abc' }] })
  let online = true
  const { writes, clock } = sessionStubs(on, { project: PROJECT, cwd: PROJECT, files: { [PROJECT + '/YOUCLONED.md']: '# rules' },
    read: (path) => writes.get(path), exists: (path) => writes.has(path) || undefined })
  on('http.fetch', ($, e) => e.url.endsWith('/feed.json')
    ? { value: online ? { status: 200, ok: true, headers: {}, text: feed } : { status: 503, ok: false, headers: {}, text: '' } }
    : { value: { status: 200, ok: true, headers: {}, text: '{}' } })
  await $.session.start({ surface: 'desktop', isInteractive: false, cwd: PROJECT })
  await clock.advance(1000)
  expect(writes.get('/Users/pat/.youcloned/feed.json')).toBe(feed)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-home' })
  expect(await ui.find({ type: 'Text', text: /Over My Shoulder: the new crew/ })).toBeDefined()
  expect((await ui.find({ key: 'home-new' })).props.label).toBe('Show me the crew')
  await ui.unmount()
  online = false
  await clock.advance(1800000)
  const ui2 = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui2.press({ key: 'tab-home' })
  expect(await ui2.find({ type: 'Text', text: /Over My Shoulder: the new crew/ })).toBeDefined()
  await ui2.unmount()
})

test('a SkillKey connector from another Claude account is forgotten and the Connect SkillKey card shows', async ($, on) => {
  const { store } = sessionStubs(on, { project: PROJECT, skillKey: null, mcpThrow: 'no connected MCP tool' })
  store.set('skillKeyServer', 'old-account-id')
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const out = await $.command.run({ command: 'youcloned', args: 'crew support' })
  expect(out.text).toMatch(/SkillKey isn't connected/)
  expect(store.get('skillKeyServer')).toBe('')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-home' })
  const links = (await ui.findAll({ type: 'Link' })).map(l => String(l.props.href))
  expect(links).toContain('https://skills.bnsn.ai/gifts/install')
  expect((await ui.findAll({ type: 'Svg' })).some(p => p.props.alt === 'Connect SkillKey')).toBe(true)
  await ui.unmount()
})

test('SkillKey is the first app, BNSN second', async ($, on) => {
  sessionStubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-home' })
  const plates = (await ui.findAll({ type: 'Svg' })).filter(p => p.props.width !== undefined && p.props.alt !== 'Thumbnail').map(p => p.props.alt)
  expect(plates.slice(0, 2)).toEqual(['skillkey', 'bnsn'])
  await ui.unmount()
})

// A fresh Mac: no developer tools, so /usr/bin/python3 is only Apple's stand-in.
function freshMac(on, sum: string) {
  const argvs: string[][] = []
  let uvInstalled = false
  const ownPython = '/Users/pat/.youcloned/python/cpython-3.12-macos-aarch64-none/bin/python3.12'
  const stubs = sessionStubs(on, { project: PROJECT, cwd: PROJECT, files: { [PROJECT + '/YOUCLONED.md']: '# rules' },
    exists: (path) => path === '/usr/bin/python3' || (path === '/Users/pat/.youcloned/bin/uv' ? uvInstalled : undefined),
    process: (argv) => {
      argvs.push(argv)
      if (argv[0] === '/usr/bin/xcode-select') return { exitCode: 2, stdout: '', stderr: 'no developer tools' }
      if (argv[0] === '/usr/bin/uname') return { exitCode: 0, stdout: 'arm64\n', stderr: '' }
      if (argv[0] === '/usr/bin/shasum') return { exitCode: 0, stdout: sum + '  /Users/pat/.youcloned/uv-download/uv.tar.gz\n', stderr: '' }
      if (argv[0] === '/bin/cp' && argv[2] === '/Users/pat/.youcloned/bin/uv') uvInstalled = true
      if (argv[0] === '/Users/pat/.youcloned/bin/uv' && argv[2] === 'find') return { exitCode: uvInstalled ? 0 : 2, stdout: uvInstalled ? ownPython + '\n' : '', stderr: '' }
      return { exitCode: 0, stdout: argv[0] === '/usr/bin/id' ? '501\n' : '', stderr: '' }
    } })
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))
  return { ...stubs, argvs, ownPython }
}

test('on a Mac with no developer tools the dashboard gets its own Python and never runs Apple\'s stand-in', async ($, on) => {
  const { writes, clock, argvs, ownPython } = freshMac(on, 'dc304b9ed1b24174572290fba60ac3f6fe63c73a671f0439e62a91375841964d')
  await $.session.start({ surface: 'desktop', isInteractive: false, cwd: PROJECT })
  await clock.advance(2000)
  expect(argvs.some(a => a[0] === '/usr/bin/curl' && a.at(-1) === 'https://github.com/astral-sh/uv/releases/download/0.12.15/uv-aarch64-apple-darwin.tar.gz')).toBe(true)
  expect(argvs.some(a => a[0] === '/Users/pat/.youcloned/bin/uv' && a[1] === 'python' && a[2] === 'install')).toBe(true)
  const plist = writes.get('/Users/pat/Library/LaunchAgents/ai.bnsn.youcloned.dashboard.plist') || ''
  expect(plist).toContain(ownPython)
  expect(plist).not.toContain('/usr/bin/python3')
  expect(argvs.some(a => a[0] === '/usr/bin/python3')).toBe(false)
})

test('a uv download that fails its checksum is never used and no dashboard service is made', async ($, on) => {
  const { writes, clock, argvs } = freshMac(on, '0'.repeat(64))
  await $.session.start({ surface: 'desktop', isInteractive: false, cwd: PROJECT })
  await clock.advance(2000)
  expect(argvs.some(a => a[0] === '/bin/cp' && a[2] === '/Users/pat/.youcloned/bin/uv')).toBe(false)
  expect(writes.has('/Users/pat/Library/LaunchAgents/ai.bnsn.youcloned.dashboard.plist')).toBe(false)
  expect(argvs.some(a => a[0] === '/usr/bin/python3')).toBe(false)
})
