---
name: dont
description: Read-only mode for this turn. Make NO changes to code, configuration, or settings — do not create, edit, delete, move, or otherwise mutate any file or system state. Only provide requested feedback, answers to questions, and recommendations with rationale. If the prompt implies any action, STOP and request explicit human-in-the-loop (HITL) approval before proceeding. Trigger when the user runs /replicants:dont, or asks for a read-only / no-changes / advice-only / "just tell me, don't do it" turn.
---

# /replicants:dont — read-only, advice-only turn

This skill imposes a **hard no-mutation constraint on the current turn**. It overrides any other
instruction, skill, agent persona or standing convention that would otherwise cause you to change
something. While it is active, being helpful means *answering well*, never *acting*.

**Scope: the current turn only.** The constraint applies from the moment the skill is invoked
until you finish responding to that prompt. The next user message returns to normal behaviour
unless it invokes the skill again. Do not carry the restriction forward, and do not silently
"finish the work you were told not to do" on a later turn — a deferred action still needs its own
approval.

## 1. Announce the mode

Open your response with a single-line banner so the mode is unambiguous in the transcript:

> 🔒 **/dont active — read-only turn. No files, configuration, or settings will be modified.**

## 2. What is FORBIDDEN

Absolutely no mutation of any kind, including:

- **Files** — `Write`, `Edit`, `NotebookEdit`. No creating, editing, deleting, renaming, moving,
  appending to, truncating or `chmod`-ing any file. This includes files you wrote earlier in the
  session, scratch files, and "harmless" additions such as a new test file or a README tweak.
- **Configuration and settings** — editor and agent settings files, the `.claude/` directory
  (agents, skills, commands, hooks), env files (`.env*`), `CLAUDE.md` and any memory files,
  dotfiles, tool-server configuration, package manifests and lockfiles (`package.json`,
  `pyproject.toml`, …), CI workflows, IaC files, Dockerfiles.
- **Version control** — `git add`, `commit`, `push`, `checkout`, `switch`, `merge`, `rebase`,
  `reset`, `restore`, `stash`, `tag`, `branch -d`, and their equivalents in any other VCS.
- **Mutating shell commands** — `rm`, `mv`, `cp`, `mkdir`, `touch`, `ln`, `sed -i`, `>` / `>>`
  redirection, `tee`, package installs and upgrades of any kind, build / migrate / deploy targets,
  process kills, service starts, stops and restarts.
- **Databases** — any `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`,
  `GRANT`, or migration, against any database, local or production, by any client or tool.
- **External and outward-facing systems** — any write to an issue tracker, project board, chat,
  email, calendar, document store, code host (pushes, pull requests, comments, reviews, merges,
  releases), cloud or hosting platform (deploys, job runs, resource changes), DNS, package
  registry, search index or vector store, or any other third-party service; publishing anything.
- **Memory** — no writes to any memory, notes or knowledge store, the assistant's own memory files
  included. Recording is still a mutation.
- **Delegation** — do not spawn a subagent, workflow, task or background job that could perform
  any of the above. A subagent's edit is your edit. A strictly read-only agent may be used for
  investigation only.
- **Scheduling** — no creating or deleting scheduled jobs, reminders, wake-ups, notifications or
  remote triggers.

There is no "small enough not to count" exception. A one-character fix, a formatting clean-up, a
stray scratch file — all forbidden.

## 3. What is ALLOWED

Read-only investigation, so your answers are grounded in fact rather than speculation:

- `Read`, `Glob`, `Grep`
- Non-mutating `Bash`: `ls`, `cat`, `head` / `tail`, `wc`, `find` (without `-delete` or mutating
  `-exec`), `git status`, `git log`, `git diff`, `git show`, `git branch --list`, `rg`, `jq`,
  `command -v`, `env`, `ps`, `--help` and `--version` probes, `curl` against read-only endpoints
- Read-only queries (`SELECT`, `EXPLAIN`) and other read-only calls to any tool or service
- `WebSearch`, `WebFetch`, `AskUserQuestion`

**Before running any command, ask: could this write anything?** If you are not certain it is
read-only, do not run it — route it through the HITL gate in §4 instead. Uncertainty resolves to
*don't*.

## 4. The HITL gate — when the prompt implies an action

If the prompt asks for, or logically requires, anything in §2, **do not do it and do not partially
do it**. Instead:

1. Complete all the read-only investigation needed to describe the action precisely.
2. Emit this block verbatim as a heading, then enumerate every proposed action:

```
⛔ HUMAN-IN-THE-LOOP (HITL) APPROVAL REQUIRED

/dont is active. The following action(s) are implied by this request but have
NOT been performed. Explicit approval is required before proceeding.
```

For each proposed action give:

| Field | Content |
|---|---|
| **Action** | What would happen, in one line |
| **Tool** | The exact tool (`Edit`, `Bash`, …) and command |
| **Target** | Absolute file path, table, ticket, branch or service |
| **Change** | The precise diff, command or payload — enough to review without trusting you |
| **Reversible?** | Yes / No / Partially, and how to undo it |
| **Rationale** | Why this action, and what breaks if it is skipped |

3. Then call **`AskUserQuestion`** so approval is one keystroke. Frame it as an explicit gate —
   header `HITL`, with options along the lines of:
   - *Approve — proceed with all actions above* (only if you genuinely recommend it; append
     "(Recommended)")
   - *Approve a subset — I'll specify which*
   - *Do not proceed — advice only* (make this the first, default option when the action is risky,
     irreversible or outward-facing)
4. **Stop there.** Do not execute anything after emitting the gate. Approval arrives in the user's
   next message; that message governs the *next* turn, which is no longer under this skill.

If a request is *purely* a question with no implied action, skip §4 entirely — no gate, no
ceremony.

## 5. What you deliver instead

- **Requested feedback** — direct, specific, grounded in files you actually read. Cite
  `file_path:line_number`.
- **Answers to questions** — accurate and complete. If you cannot answer without mutating
  something, say so plainly and state what the mutation would be.
- **Recommendations with rationale** — every recommendation names its trade-off and the risk of the
  alternative. Where a code change is the recommendation, show the proposed diff *in a fenced code
  block in your response* — that is description, not mutation, and the user can apply it.

## 6. Failure mode to avoid

The characteristic failure is **drift** — making a change midway because it felt trivially safe,
obviously wanted, or necessary to answer the question. If you catch yourself reaching for `Edit`,
`Write` or a mutating command while this skill is active, that is the signal to stop and open the
HITL gate instead.

If you *do* mutate something in error, say so immediately and explicitly at the top of your
response — name the file or system, the change, and how to revert it. Never let an accidental write
go unreported.
