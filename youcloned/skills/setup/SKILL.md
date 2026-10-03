---
name: setup
description: Set up YouCloned for this person. Interviews them about who they are, what they sell, who buys, how they sound and their brand, collects two pieces of their own writing, then saves the rules file every YouCloned conversation reads. Use when they run /youcloned setup, press "Set me up" in the YouCloned pane, or ask to set up or redo their YouCloned rules.
---

# YouCloned setup

Call the `load_setup` tool from the youcloned plugin first. It returns the setup interview from SkillKey. Follow what it returns exactly, step by step, and save with the `save_setup` tool when it says to.

If `load_setup` says SkillKey is not connected, tell the person that in one sentence and stop.
