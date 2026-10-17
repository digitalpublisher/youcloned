// The "Talk to your clone" button under the greeting card, drawn by the add-on so it can glow.
// props: { listening } . A press posts { talk: true }, which starts the clone or, while it listens, stops
// it; while the clone is in the conversation the button pulses between two blues on a timer.

const BLUE = '#3375d7'
const BLUE_DEEP = '#2659b3'
const GLOW = '#5a92ea'
const ON_BLUE = '#ffffff'
const ON_BLUE_SUB = '#d6e4fa'

export default function Talk(props, surface) {
  const { Box, Text } = surface.elements
  const p = props || {}
  if (surface.state === undefined) {
    surface.setState({ pressed: false, bright: false })
    surface.onPointer((e) => {
      if (e.type === 'down' && e.button === 'left') surface.setState({ ...surface.state, pressed: true })
      if (e.type === 'leave') surface.setState({ ...surface.state, pressed: false })
      if (e.type === 'up' && e.button === 'left') {
        surface.setState({ ...surface.state, pressed: false })
        if (e.x >= 0 && e.y >= 0 && e.x < surface.columns && e.y < surface.rows) surface.post({ talk: true })
      }
    })
    surface.onKey((e) => { if (e.key === 'return' || e.key === ' ') surface.post({ talk: true }) })
    surface.every(600, () => surface.setState({ ...surface.state, bright: !surface.state.bright }))
  }
  const st = surface.state || {}
  const live = !!p.listening
  const fill = st.pressed ? BLUE_DEEP : live ? (st.bright ? GLOW : BLUE) : BLUE
  return Box({
    key: 'talk',
    flexDirection: 'row',
    columnGap: 2,
    alignItems: 'center',
    borderStyle: 'round',
    borderColor: live ? (st.bright ? ON_BLUE : GLOW) : BLUE,
    backgroundColor: fill,
    hover: live ? undefined : { backgroundColor: BLUE_DEEP, borderColor: BLUE_DEEP },
    paddingX: 2,
    paddingY: 1,
    children: [
      Text({ key: 'dot', bold: true, color: live && st.bright ? ON_BLUE : ON_BLUE_SUB, children: [live ? '●' : '○'] }),
      Text({ key: 'l', bold: true, color: ON_BLUE, children: [live ? 'Your clone is listening' : 'Talk to your clone'] }),
      Text({ key: 's', color: ON_BLUE_SUB, wrap: 'truncate-end', children: [live ? 'Press again to stop' : 'Press, then just talk'] }),
    ],
  })
}
