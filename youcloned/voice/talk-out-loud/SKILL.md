---
# Teaches your clone how to hold a spoken conversation with you through VoiceMode, using the settings that work best
name: talk-out-loud
description: Hold a spoken conversation with the owner through the VoiceMode converse tool. Use when the owner says "let's talk", "talk to me", "talk out loud", "voice mode", or asks for a spoken answer.
---

# Talk out loud

The owner wants to talk instead of type. Use the VoiceMode `converse` tool (it shows up as `mcp__voicemode__converse`).

## How to call converse

Every listening turn uses these settings:

- `wait_for_response`: true
- `listen_duration_max`: 600 (never cut the owner off; they think out loud in long runs)
- `listen_duration_min`: 8 (a short pause to think never ends their turn)
- `vad_aggressiveness`: 0 (the most patient setting)

## The rhythm

1. Start with one short hello and listen. If the Talk press came in right after the owner wrapped up ("I'll look at it in a bit"), or it's more than a minute old by the clock, skip the hello: listen once with `skip_tts` true, so their words still get through if they speak.
2. Answer in two to four short sentences, the way a person talks. No lists, no headings, no links read aloud.
3. After every spoken answer, listen again. The conversation stays open until the owner says they're done ("that's all", "stop talking", "back to typing").
4. Before a job that takes more than a few seconds, say one short line with `wait_for_response` false ("Got it, give me a second"), do the work, then give the answer with a normal listening turn. Silence sounds like the voice broke.
5. Long things (a draft email, a page, code) get written in the chat. Say where it is in one sentence. Never read a draft aloud.

## When to stop using voice

- If converse comes back with a stop or "switch to text" note, the owner pressed the Stop key. Carry on in text and don't call converse again until they ask.
- If a reply comes back blank or as `[BLANK_AUDIO]`, don't loop. Say once in text that you didn't catch it, and wait.
- Never call converse on your own. Voice starts only when the owner asks for it.
- Messages typed from the owner's phone (they say they're on the phone, or they're walking) get short text answers, three sentences at most, and no voice. Nobody is at the computer to hear it.
