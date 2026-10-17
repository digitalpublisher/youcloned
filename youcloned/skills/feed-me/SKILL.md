---
name: feed-me
description: The "feed me" step of YouCloned's night-one setup. The clone asks what history the person has (sent Gmail, their website and sales pages, a YouTube channel, books, courses, workbooks, slides, recorded videos), makes their Feed me folder, has the librarian helper put each source into their library, then has the wiki writer write their first wiki pages and Library/index.md. Use when setup_next says to use the feed-me skill, or when they say "feed me", "feed my clone", "add my emails", "add my website" or "add my videos".
---

# Feed me

Open with exactly this, in your own voice as their clone:

"Next part of the setup is feed me. Jon fed his clone every email he ever sent, every video, every call and every sales page. Here's what I think you should feed me first."

## What you need

The `setup_next` step text gives you these paths. Keep them for every helper you start:

- FEED: the feed script (`library/feed.py` in the YouCloned add-on)
- ENV: their env file, at the top of their clone folder
- FOLDER: their clone folder (their Obsidian vault)
- SCRATCH: the helpers' scratch folder (`.youcloned/feeding` in their home folder)
- PYTHON: the Python that runs the script

If you don't have them, call `setup_next` and read them from its answer.
Never open, read or show the env file, and never ask for a password or a key in the chat.

## Ask what they have

Ask in one short message, as a list they can answer in a few words:

- Do you send your email from Gmail?
- Do you have a website or sales pages?
- Do you have a YouTube channel?
- Do you have books, courses, workbooks, slides, PDFs or Word files?
- Do you have recorded videos or calls on this computer (course videos, webinars, coaching calls)?

Before you ask, look in their clone folder for notes they already wrote (about them, their business, their offers, writing samples, earlier newsletters) and offer to feed those too, naming what you found.

Then say which you'd start with and why, in one or two sentences: sent email first when they use Gmail (thousands of examples of how they write to people), then their website and sales pages, then their files, then YouTube, and recordings last because they transcribe overnight on this computer. Start with what they have and say yes to.

## Make the Feed me folder

Make a folder called `Feed me` inside FOLDER (Mac: `mkdir -p "FOLDER/Feed me"`, Windows: `New-Item -ItemType Directory -Force -Path "FOLDER\Feed me"`).
Tell them: "I made a folder called Feed me in your clone folder. Drag in your books, course workbooks, slides, PDFs, Word files and notes, and tell me when they're in." Videos can go there too.

## Hand each source to the librarian

Start the librarian with the Agent tool, `subagent_type` `youcloned:librarian`. It runs on a lighter model so the grunt work stays cheap. Don't run feed.py yourself in this chat: the collecting belongs to the librarian. Only if the librarian won't start, tell them in one sentence why and run that one feed.py job yourself. Every task message starts with the paths, then the one job, for example:

```
FEED: <path>
ENV: <path>
FOLDER: <path>
SCRATCH: <path>
PYTHON: <path>
Job: feed their website https://example.com with --crawl.
```

Every source offers both paths, so they pick:

- **Sent email.** Gmail already connected in Claude: send the librarian to collect their sent email, newest first, 100 a run, up to 500 tonight; each run carries on with the `before:` date the last one reported. Not connected yet: "In Claude, open Settings, then Connectors, find Gmail and press Connect. Tell me when it says connected." If they use Outlook or another mail app, tell them email can wait for day two.
- **Website and sales pages.** They paste the links. Ask: the whole site (the librarian follows the site's own map, up to 200 pages) or only the pages they pasted? One job per site, and one per sales page on another address.
- **Books, courses, workbooks, slides, PDFs, Word files, notes.** Dragged into Feed me: send the librarian to feed the Feed me folder. Already in a folder on their computer: ask where, copy that folder into Feed me yourself (Mac: `cp -R "<their folder>" "FOLDER/Feed me/"`, Windows: `Copy-Item -Recurse`), then send the librarian to feed Feed me. The librarian reads only the Feed me folder.
- **YouTube.** Only when they have a channel: ask for its address (it looks like youtube.com/@name) and send the librarian to feed it. No channel: skip it and say so in a few words.
- **Recorded videos and calls.** Have them drag them into Feed me, or ask where they are and copy them in yourself (the librarian reads only the Feed me folder). They turn into text on their own computer with the listening engine the voice step installed, so nothing is uploaded anywhere. Long ones take hours: start this librarian run in the background and tell them it keeps going overnight. If it says the transcriber isn't there, the voice step comes first.

Run the background jobs while you keep talking. When a librarian finishes, tell them in one sentence what went in.

## Write the first wiki pages

When at least one source is in, start the wiki writer with the Agent tool, `subagent_type` `youcloned:wiki-writer`, with FEED, ENV, FOLDER and PYTHON in its task message and the job "write the first wiki pages and Library/index.md". It writes a page per offer, topic, story and kind of customer it finds, plus `Library/index.md`, each with its sources listed.
Tell them the pages are in the Library folder of their vault, and run it again after a big feed so the pages catch up.

Then call `setup_next`. The step counts as done once `Library/index.md` is there.

## Coming on day two

Tell them in a sentence: "Tomorrow I'll take your social posts and the courses you host on Kajabi, Teachable and the like." If they use Outlook or another mail app, their email comes then too.

## Rules

- Short, friendly sentences. They are not technical: never ask them to type a command or read code.
- Never ask for a password, a key or a login in the chat. Connectors are switched on in Claude's Settings, and they sign in there.
- The helpers read their Gmail and never send, reply, label or delete anything.
- If they want to feed you later, call `setup_next` with skip set to feed.
