// The money and promise gate for crew drafts (fix agent-b): a draft a crew member writes for a customer
// carries no income or earnings figure, no results or timeframe promise, no guarantee of results and no
// refund, price or discount promise. claimProblems(text) returns the reasons a draft breaks the rule; an
// empty list means it may be saved. Ported from the support mode of the claim gate on Jon's Mac, so a
// stated price ("$49 a month") or a stated refund policy ("a 14-day money-back guarantee") still passes.

const FIG = '(?:[$€£]\\s?\\d[\\d,.]*\\s?(?:k|m|mm)?\\b|\\b\\d[\\d,.]*\\s?(?:k|m|mm|grand|dollars?|usd)\\b' +
  '|\\b(?:six|seven|eight)[- ]figures?\\b|\\b\\d+\\s?-\\s?figures?\\b)'
const N = '(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|thirty|sixty|ninety|a few|a couple of|your first|the first)'

const POLICY = /\b(?:a |an |our |the )?(?:\d+|seven|fourteen|thirty)[- ]day money[- ]back guarantee\b|\bmoney[- ]back guarantee\b|\bfull refund within \d+ days\b/gi

const RULES = [
  ['earnings figure',
    '\\b(?:make|making|earn\\w*|pull(?:ed|s|ing)?|brought in|bring in|generat\\w+|clear(?:ed|s)?|nett?(?:ed)?|bank(?:ed)?|' +
    'income of|revenue of|profits? of|commissions? of)\\b[^.\\n]{0,25}' + FIG +
    '|' + FIG + '[^.\\n]{0,25}\\b(?:in (?:sales|revenue|profits?|income|commissions?)|' +
    'from (?:the |a |one |his |her |your |their |that |this )?(?:same )?(?:list|launch|campaign|email|webinar|offer|funnel|vsl|video|promo)|' +
    'in \\d+ days|with ai|(?:a|per) (?:month|week|day|year) (?:from|using))\\b'],
  ['earnings or results claim',
    '\\b(make|making|made|earn|earning|earned|earnings?|income|profits?|revenue|salary)\\b.{0,40}' +
    '\\b(money|cash|a month|a week|a day|a year|per month|online|from home|figures?|rich)\\b' +
    '|\\b(get rich|passive income|quit your job|financial freedom|pays? for itself)\\b' +
    '|\\b(double|triple|10x|5x|2x|3x|boost|increase|grow)\\s+(your|their)\\s+(sales|income|revenue|profits?|conversions?|money)\\b' +
    '|\\b(guarantee[ds]?|guaranteed|risk[- ]free|money[- ]back|proven to (make|earn|sell))\\b'],
  ['results or timeframe promise',
    '\\b(?:most|many|lots of|plenty of|our|the average|typical|every|all)\\s+(?:of\\s+(?:our|my|the)\\s+)?' +
    '(?:people|members|students|customers|users|clients|buyers|folks)\\b[^.\\n]{0,30}' +
    '\\b(?:see|get|start seeing|start getting|make|earn|land|close|double|hit)\\b[^.\\n]{0,30}' +
    '\\b(?:results?|money|sales|clients?|customers?|income|revenue|profits?|paid)\\b' +
    '|\\b(?:results?|money|sales|income|profits?|revenue|paying clients?|(?:your|their|his|her|a) first (?:sale|client|customer|dollar))\\b[^.\\n]{0,25}' +
    '\\b(?:in|within|inside(?: of)?)\\s+' + N + '\\s+(?:days?|weeks?|months?)\\b' +
    '|\\byou(?:\'ll| will)(?: be)?\\s+(?:making|earning|seeing results|getting results|bringing in|closing)\\b' +
    '|\\b(?:in|within|inside(?: of)?|after|by)\\s+' + N + '\\s+(?:days?|weeks?|months?)\\b[^.\\n]{0,20}' +
    '\\byou(?:\'ll| will| can expect to| should)\\b(?!\\s+(?:get|receive|hear|see)\\s+(?:an?|the|your|our)\\s+(?:email|answer|reply|link|invoice|receipt))' +
    '|\\b(?:see|get|start seeing|guarantees?)\\s+(?:fast\\s+|quick\\s+|big\\s+)?results\\b'],
  ['results promise',
    '\\byou(?:\'ll| will| are going to|\'re going to)\\s+(?:make|earn|double|triple|10x|get results|see results|succeed|get rich|' +
    'be profitable|sell out|close more)\\b|\\b(?:can\'t|cannot|won\'t) fail\\b' +
    '|\\bresults? (?:are |is )?guaranteed\\b|\\bguarantee[ds]? (?:you |your )?(?:results|sales|income|success)\\b'],
  ['refund, price or discount promise',
    '\\b(?:i|we|i\'ll|we\'ll|i will|we will|i can|we can|he will|he\'ll|she will|she\'ll)\\b[^.\\n]{0,30}' +
    '\\b(?:refund|credit (?:you|it|that|back)|waive|discount|price match|knock \\w+ off)\\w*' +
    '|\\b(?:free month|months? free|extra month|on the house|coupon|promo code|discount code|half price|lifetime access|free forever)\\b'],
].map(([name, rx]) => [name, new RegExp(rx, 'i')])

export function claimProblems(text) {
  const t = String(text || '').replace(/\u2019/g, "'").replace(POLICY, '')
  const out = []
  for (const [name, rx] of RULES) {
    const m = rx.exec(t)
    if (m) out.push(name + ': "' + m[0].trim().slice(0, 60) + '"')
  }
  return out
}
