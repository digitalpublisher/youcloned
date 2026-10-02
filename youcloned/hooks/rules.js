// The customer's rules file: what /youcloned setup collects and how it's written.
// checkSetup(input) returns a list of problems (empty when the setup can be saved).
// rulesMarkdown(input) renders the file every YouCloned conversation reads.

export const RULES_NAME = 'YOUCLONED.md'
export const MIN_SAMPLES = 2
export const MIN_SAMPLE_CHARS = 300

// Every section the rules file must have, in order, with the question setup asks.
export const SECTIONS = [
  ['name', 'Who I am', 'Your name, the way customers know you'],
  ['business', 'My business', 'What the business does, in a sentence or two'],
  ['offers', 'What I sell', 'Each product or service, its price and who it is for'],
  ['audience', 'Who buys from me', 'Who your customers are and what they want'],
  ['voice', 'How I sound', 'How you write and talk: words you use, words you never use'],
  ['brand', 'My brand', 'Colors, fonts, logo file, website'],
  ['accounts', 'Accounts I use', 'Where you sell, email, post and host (only the ones you have)'],
]

export function checkSetup(input) {
  const problems = []
  for (const [key, title] of SECTIONS) {
    if (!String(input[key] || '').trim()) problems.push('"' + title + '" (' + key + ') is empty')
  }
  const samples = Array.isArray(input.voice_samples) ? input.voice_samples.map(s => String(s || '').trim()) : []
  const longEnough = samples.filter(s => s.length >= MIN_SAMPLE_CHARS)
  if (longEnough.length < MIN_SAMPLES) {
    problems.push('voice_samples needs at least ' + MIN_SAMPLES + ' pieces the customer wrote themselves (an email, a post, a page), each ' +
      MIN_SAMPLE_CHARS + ' characters or longer; got ' + longEnough.length)
  }
  return problems
}

export function rulesMarkdown(input) {
  const parts = ['# My YouCloned rules', '',
    'Every YouCloned conversation reads this file. Change it any time, or run /youcloned setup again.', '']
  for (const [key, title] of SECTIONS) parts.push('## ' + title, '', String(input[key]).trim(), '')
  parts.push('## Samples of my writing', '', 'Match the rhythm and word choice of these. Never copy them word for word.', '')
  input.voice_samples.map(s => String(s).trim()).filter(Boolean).forEach((s, i) => {
    parts.push('### Sample ' + (i + 1), '', s, '')
  })
  return parts.join('\n')
}
