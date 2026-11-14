---
name: quorum_select
description: "Choose which Anthropic model (opus, fable, sonnet, haiku) fills each of the four /adr-consensus:adr_consensus review seats — Reviewer 1, Reviewer 2, Architect, Sweeper — for the current project, and save the choice to <project root>/.claude/adr-consensus/quorum.json. Asks one four-question selection, with each seat's current model listed first. Any model may fill any seat. Writes only quorum.json and never runs a review. Trigger when the user runs /adr-consensus:quorum_select, or asks to choose, change or show the ADR review quorum or seat models."
---

# /adr-consensus:quorum_select — map a model to each review seat

No arguments. Writes one file, `<project root>/.claude/adr-consensus/quorum.json`, which
`/adr-consensus:adr_consensus` reads on every run (per-run model flags still override it
for a single run). `<project root>` is `git rev-parse --show-toplevel` in the session's
working directory, or that directory itself outside git.

## Step 1 — read the current mapping and build the questions

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/adr_consensus/scripts/quorum.py" questions
```

Run it from the session's working directory. It prints JSON: `file`, `exists`, the
`current` seat → model table (a missing file or seat means that seat's default), any
`invalid` values found in the file, and `questions` — four ready-made questions, one per
seat (`Reviewer 1`, `Reviewer 2`, `Architect`, `Sweeper`), each with the four models as
options, the seat's current model first and labelled `(current)`. If it exits non-zero,
report its `reason` and stop: the file exists but cannot be read, and rewriting it would
destroy what is there.

If `invalid` is non-empty, tell the user which seat holds which unusable value before
asking.

## Step 2 — ask once

Make **exactly one** `AskUserQuestion` call whose `questions` are the script's four
`questions`, **verbatim and in order** — same `question`, `header`, `options` (labels and
descriptions, in order) and `multiSelect: false`. Do not reorder, rename, merge or add
options; the tool adds the free-text "Other" choice itself.

## Step 3 — write

Pass each seat's answer back **exactly as the user gave it** — the selected option label,
or the "Other" text untouched:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/adr_consensus/scripts/quorum.py" write \
  --set "reviewer_1=<answer>" --set "reviewer_2=<answer>" \
  --set "architect=<answer>"  --set "sweeper=<answer>"
```

Omit a `--set` for a seat the user did not answer. The script accepts only `opus`,
`fable`, `sonnet` or `haiku` (case-insensitive; the `(current)` label suffix is fine).
**Any other answer leaves that seat unchanged** and comes back under `rejected` — it is
never guessed, corrected or fuzzy-matched, and neither should you. The script creates
`.claude/adr-consensus/` if needed, keeps every key it does not own, stamps `updated`,
and writes the file atomically.

## Step 4 — report

Print the resulting seat → model table from the script's `seats`, the file path, and
each `rejected` answer with its reason ("left unchanged"). Say that the arbiter is not
configurable and runs on the session's model. Committing `quorum.json` so a team shares
the mapping is the user's choice — mention it, do not do it.

## What this skill must not do

- Never write anything but `quorum.json`, and never write it by hand — always through the
  script, so validation and the atomic write cannot be skipped.
- Never run a review or launch a workflow.
- Never ask more than one `AskUserQuestion` call, and never map an invalid answer to the
  nearest model.
