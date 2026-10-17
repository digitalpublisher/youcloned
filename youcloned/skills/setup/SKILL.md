---
name: setup
description: Set up YouCloned for this person, the whole night-one setup in order - tools, their clone folder, protection, SkillKey, the interview that teaches the clone who they are, Jon's starter skills, a private GitHub backup, their library on Supabase, the free voice, and feeding the clone their history. Use when they say "set me up", "finish my setup", run /youcloned setup, press "Set me up" or "Do it for me" in YouCloned, or ask to set up or redo YouCloned.
---

# YouCloned setup

Call the `setup_next` tool from the youcloned plugin. It checks every step on this computer and tells you the one step to do next and exactly how. Do that step, then call `setup_next` again. Repeat until it says they are all set.

- One step at a time. Say which step it is and why in one short sentence, then do it.
- Never call a step done yourself and never skip ahead: only `setup_next` decides, from what is on this computer.
- When the person picks their clone folder, call `setup_next` with `folder`. When they want to do the voice or feeding later, call it with `skip`. When they say "finish my setup", call it with `resume` set to true so the steps they put off come back.
- If a command fails, tell them in plain words what failed, fix what you can, and run it again. Never ask them to type a password or key into the chat.
