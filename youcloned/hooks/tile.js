// One designed YouCloned button, drawn by the add-on instead of Claude's native one.
// Each button is its own instance, so any press inside it is that button: no position math.
// props: { id, label, sub?, kind: 'primary' | 'outline' | 'chip' | 'chip-primary', hotkey? }

const BLUE = '#3375d7'
const BLUE_DEEP = '#2659b3'
const BLUE_SOFT = '#7fa9ec'
const ON_BLUE = '#ffffff'
const ON_BLUE_SUB = '#d6e4fa'

export default function Tile(props, surface) {
  const { Box, Text } = surface.elements
  const p = props || {}
  const pressed = !!(surface.state && surface.state.pressed)
  if (surface.state === undefined) {
    surface.setState({ pressed: false })
    surface.onPointer((e) => {
      if (e.type === 'down' && e.button === 'left') surface.setState({ pressed: true })
      if (e.type === 'leave') surface.setState({ pressed: false })
      if (e.type === 'up' && e.button === 'left') {
        surface.setState({ pressed: false })
        if (e.x >= 0 && e.y >= 0 && e.x < surface.columns && e.y < surface.rows) surface.post({ id: p.id })
      }
    })
    surface.onKey((e) => { if (e.key === 'return' || e.key === ' ') surface.post({ id: p.id }) })
  }
  const primary = p.kind === 'primary' || p.kind === 'chip-primary' || !p.kind
  const chip = p.kind === 'chip' || p.kind === 'chip-primary'
  const lines = [
    Text({ key: 'l', bold: true, wrap: 'truncate-end', color: primary ? ON_BLUE : BLUE_SOFT, hover: primary ? undefined : { color: ON_BLUE },
      children: [(p.hotkey ? p.hotkey + '  ' : '') + p.label] }),
  ]
  if (p.sub) lines.push(Text({ key: 's', wrap: 'truncate-end', color: primary ? ON_BLUE_SUB : BLUE_SOFT, dimColor: !primary, hover: primary ? undefined : { color: ON_BLUE_SUB }, children: [p.sub] }))
  return Box({
    key: 'tile-' + p.id,
    flexDirection: 'column',
    flexGrow: chip ? 0 : 1,
    borderStyle: 'round',
    borderColor: primary ? (pressed ? BLUE_DEEP : BLUE) : BLUE,
    backgroundColor: primary ? (pressed ? BLUE_DEEP : BLUE) : (pressed ? BLUE_DEEP : undefined),
    hover: { backgroundColor: primary ? BLUE_DEEP : BLUE, borderColor: primary ? BLUE_DEEP : BLUE },
    paddingX: chip ? 1 : 2,
    paddingY: primary && !chip ? 1 : 0,
    children: lines,
  })
}
