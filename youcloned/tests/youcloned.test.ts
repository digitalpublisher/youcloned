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
function sessionStubs(on, opts: { project?: string, agents?: unknown[], files?: Record<string, string>, process?: (argv: string[]) => unknown, toasts?: string[], lists?: Record<string, string[]> } = {}) {
  const writes = new Map<string, string>()
  const store = new Map<string, unknown>(opts.project ? [['project', opts.project]] : [])
  mock.clock(on)
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/pat' : undefined }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('fs.exists', ($, e) => ({ value: e.path in (opts.files || {}) || e.path.endsWith('/skills') }))
  on('fs.list', ($, e) => ({ value: e.path.endsWith('/skills') ? [{ name: 'setup', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }, { name: 'notes.txt', kind: 'file', size: 1, mtimeMs: 0, isLink: false }]
    : (opts.lists?.[e.path] || []).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }))
  on('fs.read', ($, e) => ({ value: (opts.files || {})[e.path] ?? (e.path.endsWith('SKILL.md') ? 'description: Set up YouCloned. More.' : 'crew prompt') }))
  on('fs.write', ($, e) => { writes.set(e.path, e.text); return { value: undefined } })
  on('tool.list', () => ({ value: [] }))
  on('tool.register', () => ({ value: undefined }))
  on('agent.register', () => ({ value: { agent: 'youcloned:x' } }))
  on('agent.list', () => ({ value: opts.agents || [] }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($, e) => { opts.toasts?.push(e.text); return { value: undefined } })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'I wrote copy/letter.md', toolUses: [] }] }))
  on('process.run', ($, e) => ({ value: opts.process ? opts.process(e.argv) : { exitCode: 1, stdout: '', stderr: '' } }))
  on('tool.call', () => ({ result: 'ran' }))
  return { writes, store }
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

test('every conversation gets the rules file', async ($, on) => {
  sessionStubs(on, { project: PROJECT, files: { [PROJECT + '/YOUCLONED.md']: '# My YouCloned rules\nPat' } })
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const out = await $.prompt.context({ blocks: [{ name: 'currentDate', text: 'today' }] })
  expect(out.blocks.length).toBe(2)
  expect(out.blocks[1].text).toMatch(/My YouCloned rules\nPat/)
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
    expect(await ui.find({ key: 'setup' })).toBeDefined()
    expect(await ui.find({ key: 'do-sales-letter' })).toBeDefined()
    expect(await ui.find({ key: 'codex' })).toBeDefined()
    await ui.press({ key: 'tab-crew' })
    expect(await ui.find({ key: 'run-support' })).toBeDefined()
    expect(await ui.find({ key: 'every-inbox' })).toBeDefined()
    await ui.press({ key: 'tab-voice' })
    expect(await ui.find({ type: 'Text', text: /Voice is not in this version/ })).toBeDefined()
    await ui.press({ key: 'tab-skills' })
    expect(await ui.find({ type: 'Text', text: /\/youcloned:setup/ })).toBeDefined()
    await ui.press({ key: 'tab-do' })
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
