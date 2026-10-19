---
name: standup
description: Run a team standup for Agent HQ - the lead asks every running member for a three-line status (done, doing, blocked) with SendMessage, collects the answers and posts one summary with what needs the person. Use when the person asks for a standup, status or "where are we", or runs /agent-hq:standup.
---

# Team standup

You are the team's lead (the main session). A standup is a short, structured check-in: every running member answers in
three lines, and you give the person one summary. It changes no work, files or team settings.

Keep every question short, use AskUserQuestion for choices (a `preview` on every option, plain text in a monospace box,
at most about 40 columns wide and 14 lines tall, drawn with `├─ └─ │ ●`, no Markdown tables, no emoji; `header` at
most 12 characters; the recommended option first with "(Recommended)" in its label), and wait for the answer.

## 1. Find who is running

Use the roster in your system prompt (the "Members" section) together with the agents you started in this session
(the names you gave them, such as `senior-dev-1`). A member is **running** when you started it and it has not reported
back as finished or been stopped. Skip finished, stopped and failed members: they get no message, they are listed in
the summary as such. The Agent HQ sidebar (`/hq`) shows the same status if you are unsure.

If nobody is running, say so in one line, summarise the last known state of the team from your own notes and stop.

## 2. Ask who to include

Skip this step when 1 or 2 members are running; ask everyone. Otherwise AskUserQuestion, header "Standup", each option
previewing who is asked:
- **Everyone running (Recommended)**: every running member.
- **Only blocked or waiting**: members that need an approval or reported a problem.
- **Pick members**: the person lists them in "Other".

```
Everyone running                  (a preview)
───────────────────────────────
Tech Lead (you)
├─ senior-dev-1  ● ask
├─ senior-dev-2  ● ask
└─ qa-1          ● ask
───────────────────────────────
3 messages · answers in 3 lines
```

## 3. Ask each member for three lines

Send each chosen member one message with SendMessage (`to` is the member's name, for example `senior-dev-1`), in the same
response so they answer in parallel. Use this text, unchanged, so the answers line up:

```
Standup from the lead. Reply with exactly three lines and nothing else:
Done: what you finished since your last report (or "nothing yet")
Doing: what you are working on right now
Blocked: what stops you, or "nothing"
Do not stop or change your current work to answer.
```

Never message a finished member (a message restarts it). Never ask a member to do new work in a standup.

## 4. Collect the answers

Replies arrive as messages from the members. Wait for them; do not poll. When a member has not answered after you have
handled the others and the person is waiting, list it as "no answer yet" instead of holding the summary back.

## 5. Post one summary

Reply with one summary, built from the answers and nothing invented:

```
Standup · <team name> · <time>

senior-dev-1 (Senior Developer)
  Done: ...   Doing: ...   Blocked: ...
qa-1 (QA Engineer)
  Done: ...   Doing: ...   Blocked: ...

Needs you: <the decisions, approvals and blockers only the person can clear, or "nothing">
Next: <what you will do next as lead>
```

- Group members that report the same blocker into one line under "Needs you".
- Use the member's own words for Done and Doing; shorten, never reword the meaning.
- End with what you are doing about each blocker (reassign, unblock, ask the person).
