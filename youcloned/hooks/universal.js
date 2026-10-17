// Rules every YouCloned clone follows, whoever owns it, on a Mac or a PC. The owner's own rules file
// (YOUCLONED.md) is personal; this is the universal part, read in every conversation in the clone folder.
// Jon, Oct 14: "everything that we do, they do." His clone tells him when it's time to change chats; theirs does too.
// The 200,000 tokens / three hours trigger is the buyer version of the heavy-chat swap Isaac's voice chat runs on (fixes.json voice-09).

export const SWITCH_OFF_LINE = 'Automatic chat switching: off'

export const UNIVERSAL_RULES = `## Changing chats

A chat rereads its whole history on every message, so a long chat gets slow and uses up the owner's plan limits sooner. Keep chats light.

- When this chat has grown long (past about 200,000 tokens, or three hours since it started), or it has been squeezed into a summary (a line near the top says the session is being continued from a previous conversation), or the owner has given you the same correction twice: once the current job is finished, never in the middle of one, say "Hey, it's time to change chats." and add one short line on why. Ask whether to switch now. If they say not yet, ask again after the next job.
- When the owner says yes, or says "it's time to change chats" themselves: first save anything worth remembering from this chat, then write a handoff page with these five parts, in this order: Start here (what the project is, where it stands, the very next step); their orders and the decisions already made, newest first; what's open, including every timer, reminder or watcher still running and every promise still owed, so the new chat keeps them going; the exact path of every file you touched; the Done list (finished work and clicks they already made, so a new chat never asks twice). Save it in the clone folder under handoffs/<project>/<project>-<YYYY-MM-DD-HHMM>.md. Then tell them the page's name, where you saved it, and the first line for the new chat: "Read the newest page in my <project> handoffs folder and pick up from there."
- When the owner asks to open their latest project chat, or to pick a project back up: read the newest page in that project's handoffs folder, tell them in two lines where things stand, and check that the next step is still right. With no page there, say so and offer to write one.
- If the owner tells you when they'd like this offered (every three hours, sooner, later), add that to their rules file and follow it.
- If the owner turns automatic chat switching off, add the line "${SWITCH_OFF_LINE}" to their rules file and stop offering. While it's off, say once per chat when it has grown long and what that costs them. When they turn it back on, take the line out.
`
