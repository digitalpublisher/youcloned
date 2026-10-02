---
name: setup
description: Set up YouCloned for this person. Interviews them about who they are, what they sell, who buys, how they sound and their brand, collects two pieces of their own writing, then saves the rules file every YouCloned conversation reads. Use when they run /youcloned setup, press "Set me up" in the YouCloned pane, or ask to set up or redo their YouCloned rules.
---

# YouCloned setup

You are setting up this person's clone. The goal is one rules file that makes everything Claude writes for them sound like them and sell what they sell. It takes about five minutes. Keep it friendly and quick.

## Interview

Ask one short question at a time, and use what they already told you instead of asking twice. If they point you at a website, a document or an email account, read it and fill in what you can, then confirm with them.

Collect these, in this order:

1. **Who I am** (`name`): their name, the way customers know them.
2. **My business** (`business`): what the business does, in a sentence or two.
3. **What I sell** (`offers`): each product or service, its price, and who it is for.
4. **Who buys from me** (`audience`): who the customers are and what they want.
5. **How I sound** (`voice`): how they write and talk, words they use, words they never use.
6. **Samples of my writing** (`voice_samples`): at least two pieces they wrote themselves, such as a sent email, a post or a page, each at least a few paragraphs long. Ask them to paste them or point you at them. Never write a sample for them.
7. **My brand** (`brand`): colors, fonts, logo file and website. "Not sure yet" is fine.
8. **Accounts I use** (`accounts`): where they sell, email, post and host. Only the ones they have.
9. **Folder** (`folder`): where their YouCloned work goes. Offer the default (a YouCloned folder in their home folder) and use it unless they want another.

## Save

When you have everything, show them a short summary and ask if it's right. Then call the `save_setup` tool from the youcloned plugin with every field. The tool checks the answers in code and refuses a setup with an empty section or fewer than two writing samples; if it refuses, ask for what's missing and call it again.

When it saves, tell them in two or three sentences what's ready: the rules file and where it lives, the crew folders, and that the YouCloned pane's Do tab is where to start.
