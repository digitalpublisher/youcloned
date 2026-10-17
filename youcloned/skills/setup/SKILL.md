---
name: setup
description: Set up YouCloned for this person, the whole night-one setup in order - tools, their clone folder, protection, SkillKey, the interview that teaches the clone who they are, Jon's starter skills, a private GitHub backup, their library on Supabase, the free voice, and feeding the clone their history. Use when they say "set me up", "finish my setup", "upgrade my clone" (someone who set up an earlier YouCloned: everything they have is kept and only what is missing or new gets added), "add my library" or "set up my voice" (just that one step), run /youcloned setup, press "Set me up" or "Do it for me" in YouCloned, or ask to set up or redo YouCloned.
---

# YouCloned setup

Call the `setup_next` tool from the youcloned plugin. It checks every step on this computer and tells you the one step to do next and exactly how. Do that step, then call `setup_next` again. Repeat until it says they are all set.

- One step at a time. Say which step it is and why in one short sentence, then do it.
- Never call a step done yourself and never skip ahead: only `setup_next` decides, from what is on this computer.
- When the person picks their clone folder, call `setup_next` with `folder`. When they want to do the backup, the voice or feeding later, call it with `skip`. When they say "finish my setup", call it with `resume` set to true so the steps they put off come back. When they like their clone and want to add just one thing ("add my library", "set up my voice", "just add the backup"), call it with `only` set to that step, and it says what that step needs first.
- Someone may already have some or all of this, from an earlier YouCloned or their own setup. setup_next checks each step first: what they already have counts as done and is skipped, and nothing of theirs is overwritten without asking. Tell them that in one sentence on the first call.
- If a command fails, tell them in plain words what failed, fix what you can, and run it again. Never ask them to type a password or key into the chat.
