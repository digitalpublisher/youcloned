// The YouCloned panel's pictures for the desktop app: the same design as the dashboard,
// drawn as SVG so it can sit in Claude's own panel. Claude's buttons go under each picture.

import { MARK_WHITE, BNSN, BOOKBUILDER, IMPROVER, COURSEBUILDER, AIC, WORDMARK, LATEST_VIDEO, SKILLKEY } from './logo.js'

const FONT = 'font-family="-apple-system,BlinkMacSystemFont,Helvetica Neue,Arial,sans-serif"'
// The drawing width. The panel sets it from its own width so text stays at its normal size.
export let W = 640
export function setWidth(w) { W = Math.round(Math.max(640, Math.min(1400, w))) }

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// A round gauge filled from the bottom like a fuel tank. pct is how much is left, 0 to 100, or null.
function tank(x, y, r, pct, color, id) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct))
  const top = y - r + 2 * r * (1 - p / 100)
  return '<clipPath id="' + id + '"><circle cx="' + x + '" cy="' + y + '" r="' + r + '"/></clipPath>' +
    '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#ffffff" fill-opacity=".12"/>' +
    '<rect clip-path="url(#' + id + ')" x="' + (x - r) + '" y="' + top.toFixed(1) + '" width="' + 2 * r + '" height="' + (2 * r + 2) + '" fill="' + color + '"/>' +
    '<circle cx="' + (x - r * 0.35) + '" cy="' + (y - r * 0.4) + '" r="' + r * 0.22 + '" fill="#ffffff" fill-opacity=".18"/>'
}

// The gauge tiles sit in a 248-wide column at the card's right edge.
const tilesX = () => W - 268

function tile(y, gauge, big, small) {
  const x = tilesX()
  return '<rect x="' + x + '" y="' + y + '" width="248" height="54" rx="11" fill="#ffffff" fill-opacity=".09" stroke="#ffffff" stroke-opacity=".16"/>' +
    gauge +
    '<text x="' + (x + 64) + '" y="' + (y + 25) + '" ' + FONT + ' font-size="19" font-weight="700" fill="#ffffff">' + big + '</text>' +
    '<text x="' + (x + 64) + '" y="' + (y + 43) + '" ' + FONT + ' font-size="11.5" fill="#c8d7f2">' + esc(small) + '</text>'
}

// The blue greeting card: the mark, the greeting, what needs the owner, and the three gauges.
// codexPlan: { left, label } from Codex's own usage record, or null when it has none yet.
export function heroSvg({ name, left, reset, span, words, codex, codexPlan, lines }) {
  const hour = new Date().getHours()
  const hi = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const list = (lines || []).slice(0, 3).map((t, i) =>
    '<circle cx="34" cy="' + (132 + i * 26) + '" r="3" fill="#bcd3f7"/>' +
    '<text x="46" y="' + (137 + i * 26) + '" ' + FONT + ' font-size="13.5" fill="#e6eefb">' + esc(t) + '</text>').join('')
  const claude = tile(26, tank(tilesX() + 32, 53, 18, left, '#e59672', 'g1'),
    left == null ? '…' : Math.round(left) + '<tspan font-size="12" fill="#a9bde0">% left</tspan>', (span || 'Claude plan') + (reset ? ' · resets ' + reset : ''))
  const cdx = codexPlan
    ? tile(88, tank(tilesX() + 32, 115, 18, codexPlan.left, '#8fb6f4', 'g2'),
      Math.round(codexPlan.left) + '<tspan font-size="12" fill="#a9bde0">% left</tspan>', codexPlan.label)
    : tile(88, tank(tilesX() + 32, 115, 18, codex ? 100 : 0, '#8fb6f4', 'g2'),
      codex ? 'Ready' : 'Connect', codex ? 'Codex checks your work' : 'Codex, your second opinion')
  const tx = tilesX()
  const wordTile = '<rect x="' + tx + '" y="150" width="248" height="54" rx="11" fill="#ffffff" fill-opacity=".09" stroke="#ffffff" stroke-opacity=".16"/>' +
    '<rect x="' + (tx + 14) + '" y="159" width="36" height="36" rx="9" fill="#ffffff" fill-opacity=".14"/>' +
    '<g transform="translate(' + (tx + 18) + ' 163) scale(.29)" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="24" width="72" height="54" rx="12"/><path d="M20 24l38-10c4-1 8 2 8 6v4"/><path d="M25 43h26M25 56h18"/></g>' +
    '<text x="' + (tx + 64) + '" y="175" ' + FONT + ' font-size="19" font-weight="700" fill="#ffffff">' + (words == null ? 'Connect' : Number(words).toLocaleString('en-US')) + '</text>' +
    '<text x="' + (tx + 64) + '" y="193" ' + FONT + ' font-size="11.5" fill="#c8d7f2">' + (words == null ? 'SkillKey shows your words' : 'BNSN words') + '</text>'
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="230" viewBox="0 0 ' + W + ' 230">' +
    '<defs><radialGradient id="bg" cx="0" cy="0" r="1.1" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="#4c8ff0"/><stop offset=".45" stop-color="#2f6fd0"/><stop offset="1" stop-color="#1d4fa6"/></radialGradient>' +
    '<radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffffff" stop-opacity=".18"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>' +
    '<rect width="' + W + '" height="230" rx="16" fill="url(#bg)"/>' +
    '<clipPath id="hc"><rect width="' + W + '" height="230" rx="16"/></clipPath><circle clip-path="url(#hc)" cx="' + (W - 80) + '" cy="0" r="170" fill="url(#glow)"/>' +
    '<circle cx="56" cy="62" r="38" fill="#ffffff" fill-opacity=".08" stroke="#ffffff" stroke-opacity=".22"/>' +
    '<image href="' + MARK_WHITE + '" x="30" y="36" width="52" height="52"/>' +
    '<text x="108" y="58" ' + FONT + ' font-size="25" font-weight="700" fill="#ffffff">' + esc(hi + ', ' + (name || 'there')) + '</text>' +
    '<text x="108" y="81" ' + FONT + ' font-size="13" fill="#c8d7f2">Tap a job below, or just type in Claude</text>' +
    list + claude + cdx + wordTile + '</svg>'
}

// Shared look for the dark cards under the greeting, matching the dashboard's panels.
const SURFACE = '#161d29', LINE = '#283346', INK = '#e6ebf3', INK2 = '#aab4c5', INK3 = '#808c9f'
const BLUE = '#5a92ea', BLUE_INK = '#8fb6f4'
const ICONS = {
  money: '<path d="M12 3v18M16 7.5c0-1.9-1.8-3-4-3s-4 1.1-4 3 1.8 2.6 4 3 4 1.2 4 3.2-1.8 3.3-4 3.3-4-1.2-4-3.1"/>',
  crew: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3.5 19c.7-3 2.8-4.5 5.5-4.5s4.8 1.5 5.5 4.5M15 14.3c2.4 0 4.2 1.3 5 3.7"/>',
  apps: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/>',
}

function svgOpen(h) {
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + h + '" viewBox="0 0 ' + W + ' ' + h + '">'
}

// A card with the dashboard's header row: tinted icon, title, an optional Sample tag and a note on the right.
function card(h, { icon, color, title, sample, meta }) {
  const titleW = title.length * 8.6
  const tag = sample ? '<rect x="' + (52 + titleW) + '" y="15" width="56" height="20" rx="5" fill="#1d2635"/>' +
    '<text x="' + (80 + titleW) + '" y="29" text-anchor="middle" ' + FONT + ' font-size="11" font-weight="600" fill="' + INK3 + '">Sample</text>' : ''
  return '<rect x=".5" y=".5" width="' + (W - 1) + '" height="' + (h - 1) + '" rx="13" fill="' + SURFACE + '" stroke="' + LINE + '"/>' +
    '<rect x="16" y="13" width="24" height="24" rx="7" fill="' + color + '" fill-opacity=".16"/>' +
    '<g transform="translate(20 17) scale(.67)" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[icon] + '</g>' +
    '<text x="50" y="30" ' + FONT + ' font-size="15.5" font-weight="700" fill="' + INK + '">' + esc(title) + '</text>' + tag +
    (meta ? '<text x="' + (W - 18) + '" y="30" text-anchor="end" ' + FONT + ' font-size="12" fill="' + INK3 + '">' + esc(meta) + '</text>' : '') +
    '<line x1="1" x2="' + (W - 1) + '" y1="50" y2="50" stroke="' + LINE + '"/>'
}

// A rounded label with a dot, like the dashboard's pills. Right-aligned at x.
function pill(xRight, y, label, color) {
  const w = label.length * 6.9 + 26
  const x = xRight - w
  return '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) + '" height="22" rx="11" fill="' + color + '" fill-opacity=".16"/>' +
    '<circle cx="' + (x + 11).toFixed(1) + '" cy="' + (y + 11) + '" r="3" fill="' + color + '"/>' +
    '<text x="' + (x + 19).toFixed(1) + '" y="' + (y + 15.5) + '" ' + FONT + ' font-size="12" font-weight="600" fill="' + color + '">' + esc(label) + '</text>'
}

function money(n) {
  return '$' + Math.round(n).toLocaleString('en-US')
}

// The top bar: the YouCloned logo and today's date, like the dashboard's menu bar.
export function topSvg() {
  const h = 56
  const lw = 138, lh = lw * WORDMARK.h / WORDMARK.w
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return svgOpen(h) +
    '<rect x=".5" y=".5" width="' + (W - 1) + '" height="' + (h - 1) + '" rx="13" fill="' + SURFACE + '" stroke="' + LINE + '"/>' +
    '<image href="' + WORDMARK.src + '" x="18" y="' + ((h - lh) / 2).toFixed(1) + '" width="' + lw + '" height="' + lh.toFixed(1) + '"/>' +
    '<text x="' + (W - 18) + '" y="33" text-anchor="end" ' + FONT + ' font-size="12.5" fill="' + INK3 + '">' + esc(today) + '</text></svg>'
}

// Made or saved this week: the total, the change, a split bar and the three parts.
export function moneySvg({ total, up, parts, sample }) {
  const h = 168
  const sum = parts.reduce((a, p) => a + p.value, 0) || 1
  let x = 20
  const barW = W - 40
  const bar = parts.map((p, i) => {
    const w = barW * p.value / sum
    const seg = '<rect x="' + x.toFixed(1) + '" y="112" width="' + Math.max(0, w - (i < parts.length - 1 ? 3 : 0)).toFixed(1) + '" height="8" rx="4" fill="' + p.color + '"/>'
    x += w
    return seg
  }).join('')
  let lx = 20
  const legend = parts.map(p => {
    const label = p.label + ' ' + money(p.value)
    const out = '<rect x="' + lx + '" y="137" width="9" height="9" rx="2" fill="' + p.color + '"/>' +
      '<text x="' + (lx + 15) + '" y="146" ' + FONT + ' font-size="12.5" fill="' + INK2 + '">' + esc(label) + '</text>'
    lx += 15 + label.length * 7 + 22
    return out
  }).join('')
  const big = money(total)
  const upLabel = up == null ? '' : (up >= 0 ? 'Up ' : 'Down ') + Math.abs(up) + '%'
  return svgOpen(h) + card(h, { icon: 'money', color: BLUE, title: 'Made or saved this week', sample }) +
    '<text x="20" y="98" ' + FONT + ' font-size="40" font-weight="800" letter-spacing="-1" fill="' + INK + '">' + big + '</text>' +
    (upLabel ? pill(20 + big.length * 20 + 16 + upLabel.length * 6.9 + 26, 75, upLabel, BLUE_INK) : '') +
    bar + legend + '</svg>'
}




// The header row of an action card (icon, title, optional Sample tag and note), drawn on the card's own
// navy so it sits inside a Claude box whose background and border match the picture cards.
export function cardHeadSvg({ icon, color, title, sample, meta }) {
  const h = 50
  const titleW = title.length * 8.6
  const tag = sample ? '<rect x="' + (52 + titleW) + '" y="15" width="56" height="20" rx="5" fill="#1d2635"/>' +
    '<text x="' + (80 + titleW) + '" y="29" text-anchor="middle" ' + FONT + ' font-size="11" font-weight="600" fill="' + INK3 + '">Sample</text>' : ''
  return svgOpen(h) + '<rect width="' + W + '" height="' + h + '" fill="' + SURFACE + '"/>' +
    '<rect x="16" y="13" width="24" height="24" rx="7" fill="' + color + '" fill-opacity=".16"/>' +
    '<g transform="translate(20 17) scale(.67)" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[icon] + '</g>' +
    '<text x="50" y="30" ' + FONT + ' font-size="15.5" font-weight="700" fill="' + INK + '">' + esc(title) + '</text>' + tag +
    (meta ? '<text x="' + (W - 18) + '" y="30" text-anchor="end" ' + FONT + ' font-size="12" fill="' + INK3 + '">' + esc(meta) + '</text>' : '') +
    '<line x1="0" x2="' + W + '" y1="49.5" y2="49.5" stroke="' + LINE + '"/></svg>'
}

// One app's logo on its plate, drawn at a set size so its button can sit right under it.
export const PLATE = { w: 132, h: 52 }
export function plateSvg(name) {
  const { w: pw, h: ph } = PLATE
  const a = { skillkey: SKILLKEY, bnsn: BNSN, bookbuilder: BOOKBUILDER, improver: IMPROVER, coursebuilder: COURSEBUILDER, aic: AIC }[name]
  let inner
  if (!a) {
    const cx = pw / 2 - 50
    inner = '<rect x="' + cx + '" y="15" width="22" height="22" rx="6" fill="#3375d7"/>' +
      '<g transform="translate(' + (cx + 4) + ' 19) scale(.58)" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"><circle cx="7" cy="12" r="3"/><circle cx="17" cy="12" r="3"/><path d="M10 12h4"/></g>' +
      '<text x="' + (cx + 30) + '" y="31.5" ' + FONT + ' font-size="14" font-weight="700" fill="#ffffff">OfferBuilder</text>'
  } else {
    const lw = Math.min(pw - 30, a.w * 20 / a.h), lh = lw * a.h / a.w
    inner = '<image href="' + a.src + '" x="' + ((pw - lw) / 2).toFixed(1) + '" y="' + ((ph - lh) / 2).toFixed(1) + '" width="' + lw.toFixed(1) + '" height="' + lh.toFixed(1) + '"/>'
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + pw + '" height="' + ph + '" viewBox="0 0 ' + pw + ' ' + ph + '">' +
    '<rect width="' + pw + '" height="' + ph + '" rx="10" fill="#22304a"/>' + inner + '</svg>'
}

// The newest video's thumbnail, rounded, at a set size.
export const THUMB = { w: 208, h: 117 }
// src: the feed's thumbnail as a data address, or the one that ships with the add-on.
export function thumbSvg(src) {
  const img = src || LATEST_VIDEO
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + THUMB.w + '" height="' + THUMB.h + '" viewBox="0 0 ' + THUMB.w + ' ' + THUMB.h + '">' +
    '<clipPath id="t"><rect width="' + THUMB.w + '" height="' + THUMB.h + '" rx="9"/></clipPath>' +
    '<image clip-path="url(#t)" href="' + img + '" width="' + THUMB.w + '" height="' + THUMB.h + '" preserveAspectRatio="xMidYMid slice"/></svg>'
}
