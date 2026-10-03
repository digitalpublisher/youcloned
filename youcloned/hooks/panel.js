// The YouCloned panel's pictures for the desktop app: the same design as the dashboard,
// drawn as SVG so it can sit in Claude's own panel. Claude's buttons go under each picture.

import { MARK_WHITE, BNSN, BOOKBUILDER, IMPROVER, COURSEBUILDER, AIC } from './logo.js'

const FONT = 'font-family="-apple-system,BlinkMacSystemFont,Helvetica Neue,Arial,sans-serif"'
export const W = 640

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

function tile(y, gauge, big, small) {
  return '<rect x="392" y="' + y + '" width="226" height="54" rx="11" fill="#ffffff" fill-opacity=".09" stroke="#ffffff" stroke-opacity=".16"/>' +
    gauge +
    '<text x="456" y="' + (y + 25) + '" ' + FONT + ' font-size="19" font-weight="700" fill="#ffffff">' + big + '</text>' +
    '<text x="456" y="' + (y + 43) + '" ' + FONT + ' font-size="11.5" fill="#c8d7f2">' + esc(small) + '</text>'
}

// The blue greeting card: the mark, the greeting, what needs the owner, and the three gauges.
export function heroSvg({ name, left, reset, words, codex, lines }) {
  const hour = new Date().getHours()
  const hi = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const list = (lines || []).slice(0, 3).map((t, i) =>
    '<circle cx="34" cy="' + (139 + i * 26) + '" r="3" fill="#bcd3f7"/>' +
    '<text x="46" y="' + (144 + i * 26) + '" ' + FONT + ' font-size="13.5" fill="#e6eefb">' + esc(t) + '</text>').join('')
  const claude = tile(26, tank(424, 53, 18, left, '#e59672', 'g1'),
    left == null ? '…' : Math.round(left) + '<tspan font-size="12" fill="#a9bde0">% left</tspan>', 'Claude plan' + (reset ? ' · resets ' + reset : ''))
  const cdx = tile(88, tank(424, 115, 18, codex ? 100 : 0, '#8fb6f4', 'g2'),
    codex ? 'Ready' : 'Connect', codex ? 'Codex checks your work' : 'Codex, your second opinion')
  const wordTile = '<rect x="392" y="150" width="226" height="54" rx="11" fill="#ffffff" fill-opacity=".09" stroke="#ffffff" stroke-opacity=".16"/>' +
    '<rect x="406" y="159" width="36" height="36" rx="9" fill="#ffffff" fill-opacity=".14"/>' +
    '<g transform="translate(410 163) scale(.29)" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="24" width="72" height="54" rx="12"/><path d="M20 24l38-10c4-1 8 2 8 6v4"/><path d="M25 43h26M25 56h18"/></g>' +
    '<text x="456" y="175" ' + FONT + ' font-size="19" font-weight="700" fill="#ffffff">' + (words == null ? 'Link' : Number(words).toLocaleString('en-US')) + '</text>' +
    '<text x="456" y="193" ' + FONT + ' font-size="11.5" fill="#c8d7f2">' + (words == null ? 'Connect SkillKey' : 'BNSN words') + '</text>'
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="230" viewBox="0 0 ' + W + ' 230">' +
    '<defs><radialGradient id="bg" cx="0" cy="0" r="1.1" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="#4c8ff0"/><stop offset=".45" stop-color="#2f6fd0"/><stop offset="1" stop-color="#1d4fa6"/></radialGradient>' +
    '<radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffffff" stop-opacity=".18"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>' +
    '<rect width="' + W + '" height="230" rx="16" fill="url(#bg)"/>' +
    '<circle cx="560" cy="0" r="170" fill="url(#glow)"/>' +
    '<circle cx="56" cy="62" r="38" fill="#ffffff" fill-opacity=".08" stroke="#ffffff" stroke-opacity=".22"/>' +
    '<image href="' + MARK_WHITE + '" xlink:href="' + MARK_WHITE + '" x="30" y="36" width="52" height="52"/>' +
    '<text x="108" y="58" ' + FONT + ' font-size="25" font-weight="700" fill="#ffffff">' + esc(hi + ', ' + (name || 'there')) + '</text>' +
    '<text x="108" y="81" ' + FONT + ' font-size="13" fill="#c8d7f2">Tap a job below, or just type in Claude</text>' +
    list + claude + cdx + wordTile + '</svg>'
}

// The crew card: each helper, its job, and what is waiting for the owner.
export function crewSvg(rows) {
  const h = 54 + rows.length * 46
  const body = rows.map((r, i) => {
    const y = 52 + i * 46
    const bw = r.badge.length * 7.2 + 16
    const tone = r.waiting ? ['#e8b25c', '#e8b25c'] : ['#5a92ea', '#8fb6f4']
    const pill = '<rect x="' + (W - 14 - bw) + '" y="' + (y + 6) + '" width="' + bw + '" height="22" rx="11" fill="' + tone[0] + '" fill-opacity=".18"/>' +
      '<text x="' + (W - 22) + '" y="' + (y + 21) + '" text-anchor="end" ' + FONT + ' font-size="12" font-weight="700" fill="' + tone[1] + '">' + esc(r.badge) + '</text>'
    return (i ? '<line x1="20" x2="' + (W - 20) + '" y1="' + (y - 4) + '" y2="' + (y - 4) + '" stroke="#ffffff" stroke-opacity=".08"/>' : '') +
      '<text x="20" y="' + (y + 16) + '" ' + FONT + ' font-size="14" font-weight="600" fill="#e6ebf3">' + esc(r.title) + '</text>' +
      '<text x="20" y="' + (y + 34) + '" ' + FONT + ' font-size="12" fill="#94a0b4">' + esc(r.what) + '</text>' + pill
  }).join('')
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + h + '" viewBox="0 0 ' + W + ' ' + h + '">' +
    '<rect width="' + W + '" height="' + h + '" rx="14" fill="#141c2b" stroke="#283346"/>' +
    '<rect x="16" y="14" width="24" height="24" rx="7" fill="#e8b25c" fill-opacity=".16"/>' +
    '<g transform="translate(20 18) scale(.67)" fill="none" stroke="#e8b25c" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3.5 19c.7-3 2.8-4.5 5.5-4.5s4.8 1.5 5.5 4.5M15 14.3c2.4 0 4.2 1.3 5 3.7"/></g>' +
    '<text x="50" y="31" ' + FONT + ' font-size="15.5" font-weight="700" fill="#e6ebf3">Your crew</text>' + body + '</svg>'
}

// The row of BNSN app logos on dark plates.
export function appsSvg() {
  const apps = [BNSN, BOOKBUILDER, IMPROVER, COURSEBUILDER, AIC]
  const pw = 116, gap = 9
  const plates = apps.map((a, i) => {
    const x = 20 + i * (pw + gap)
    const w = Math.min(pw - 20, a.w * 22 / a.h)
    const ih = w * a.h / a.w
    return '<rect x="' + x + '" y="46" width="' + pw + '" height="50" rx="9" fill="#0e1830" stroke="#283346"/>' +
      '<image href="' + a.src + '" xlink:href="' + a.src + '" x="' + (x + (pw - w) / 2).toFixed(1) + '" y="' + (71 - ih / 2).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + ih.toFixed(1) + '"/>'
  }).join('')
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="112" viewBox="0 0 ' + W + ' 112">' +
    '<rect width="' + W + '" height="112" rx="14" fill="#141c2b" stroke="#283346"/>' +
    '<rect x="16" y="12" width="24" height="24" rx="7" fill="#5a92ea" fill-opacity=".16"/>' +
    '<g transform="translate(20 16) scale(.67)" fill="none" stroke="#8fb6f4" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></g>' +
    '<text x="50" y="29" ' + FONT + ' font-size="15.5" font-weight="700" fill="#e6ebf3">Your BNSN apps</text>' + plates + '</svg>'
}
