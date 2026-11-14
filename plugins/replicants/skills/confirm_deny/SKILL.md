---
name: confirm_deny
description: Validate every assumption and/or assertion in the user's current prompt before answering it. Each claim gets an explicit verdict — when it is valid, CONFIRM it with clear, unhedged affirmation language; when it is invalid (wholly or in part), DENY it, explain exactly why it is wrong, and give the corrected, accurate statement that resolves it. Claims are checked against real evidence (code, files, command output, docs, the web) wherever they can be, not answered from memory; a claim the available evidence cannot settle is marked UNRESOLVED rather than forced. Trigger when the user runs /replicants:confirm_deny, when the literal token `/replicants:confirm_deny` (or its bare alias `/confirm_deny`) appears anywhere in the current message, or when the user asks to "confirm or deny", "validate my assumption(s)", "check whether my assertion is right", or "am I right that…". Applies to the current turn only.
---

# /replicants:confirm_deny — validate the prompt's assumptions and assertions, then confirm or correct

This skill adds a **verification pass over the user's own claims** to the current turn. Before (or instead of) doing what the prompt asks, find every assumption and assertion it contains, test each one, and give each a plain verdict. When it is active, being helpful means telling the user — unambiguously — which of their beliefs are right and which are wrong, and replacing each wrong one with the accurate version.

**Scope: the current turn only.** The next user message returns to normal behavior unless it invokes the skill again.

## 1. Announce the mode

Open the response with a single-line banner:

> ✅❌ **/confirm_deny active — each assumption and assertion below is checked and confirmed or corrected.**

If another active skill also requires a banner (for example `/replicants:dont` or `/replicants:verb`), show every banner, one per line, before the body.

## 2. Extract the claims

Read the whole prompt and list every claim it rests on. There are two kinds:

- **Assertions** — statements the user makes outright. *"The API container hot-reloads."* *"`git stash` keeps untracked files."*
- **Assumptions** — beliefs the prompt takes for granted without stating them. *"Why does the migration fail on 0082?"* assumes the migration fails, and fails on 0082. *"Make the cron run hourly again"* assumes it once ran hourly.

Rules:

- **Surface implicit assumptions, not just explicit assertions.** A question built on a false premise is the most important thing to catch.
- **Split compound claims.** "X is in `foo.py` and is called on startup" is two claims; each gets its own verdict.
- **Skip what is not a claim.** Requests, preferences, opinions and hypotheticals the user has framed as such ("I'd like…", "suppose…") are not true or false; do not manufacture verdicts for them.
- **Quote or closely paraphrase each claim** so the user can see exactly what was judged.

## 3. Verify each claim against evidence

A verdict is only as good as its evidence. For every claim:

- **Check it, don't recall it.** If a claim is about code, files, configuration, a database, a running service, a command's behavior, a third-party tool, or the outside world, go and look. Prefer the cheapest check that is actually decisive.
- **Use the verification toolset** — pick whichever tool reaches the evidence:

  | Evidence needed | Tools |
  |---|---|
  | Code, files, configuration | `Read`, `Grep`, `Glob` |
  | How a command or system behaves right now | read-only `Bash` (`git log`, `ls`, `--help`, `--version`, `curl` against read-only endpoints) |
  | Data | read-only database queries (`SELECT`, `EXPLAIN`) and other read-only tool calls |
  | Docs, libraries, APIs, versions, pricing, standards, public facts, recent events | **`WebSearch`** to find sources, **`WebFetch`** to read the page that decides the claim |

- **Search the web for any claim the local evidence cannot settle** — especially claims about third-party software (behavior, flags, defaults, deprecations, version support), external services and their limits, and any fact that could have changed since training. Do not confirm or deny such a claim from memory when a search can decide it. Start with a focused `WebSearch`; broaden or rephrase when results are thin, off-target or possibly stale, or when the fact is niche or very recent. Run independent searches in parallel.
- **Prefer primary sources** — official docs, changelogs, specifications, the project's own repository — over blog posts and forums. When sources disagree, say so and give the verdict the most authoritative, most recent one supports. Read the page with `WebFetch` when a search snippet alone does not decide the claim.
- **Cite the evidence** with each verdict: `file_path:line_number`, the command and its output, the query and row, or the URL of the web page that decided it.
- **Use reasoning only where reasoning is the evidence** — logic, math, definitions, well-established facts. Show the step that decides it.
- **Do not let the user's confidence or phrasing tilt the verdict.** A claim stated firmly is checked as hard as one stated tentatively.

## 4. Deliver a verdict for each claim

Use exactly one of these verdicts per claim.

### ✅ CONFIRMED — the claim is valid

State it with clear affirmation language. No hedging, no "it seems", no "probably", no "I think". For example:

> ✅ **CONFIRMED — you are correct.** `retry()` does back off exponentially — the delay doubles on each attempt (`src/http/retry.py:42`).

Other acceptable openers: *"Yes — that is correct."*, *"Confirmed: that is accurate."*, *"You're right."* Then give the evidence in one or two lines.

### ❌ DENIED — the claim is invalid

Deny it plainly, then give all three parts:

1. **Why it is wrong** — the specific fact, line of code, output, or reasoning that contradicts it.
2. **The corrected statement** — what is actually true, written so it can replace the user's claim word-for-word in their mental model.
3. **What follows** — if the error changes the answer to the user's request, say how (for example "so the fix belongs in the image build, not the source file").

> ❌ **DENIED — that is not correct.** The API container does not hot-reload; it serves code baked into the image at build time (`docker-compose.yml:14` mounts no source directory).
> **Correct:** backend edits take effect only after the image is rebuilt.
> **So:** the change you made is present on disk but not yet running.

### ⚠️ PARTIALLY CORRECT — part holds, part does not

Use this only when a claim cannot be cleanly split into separate claims. Confirm the true part with affirmation language, deny the false part with the three-part correction above, and finish with the single corrected statement of the whole claim.

### ❔ UNRESOLVED — the evidence to decide it is not available

Do not force a verdict. State what was checked, what evidence would settle it, and — if there is one — the most likely answer, clearly labeled as unconfirmed. Say explicitly that the claim is UNRESOLVED — never present an unverified claim as confirmed or denied. Use this sparingly: if a check is possible and cheap — including a web search — run it instead of reaching for this verdict.

## 5. Response layout

1. The banner (§1).
2. **Verdicts** — one entry per claim, in the order the claims appear in the prompt, each headed by its verdict marker and the quoted claim. With more than about four claims, open with a summary table (`#`, Claim, Verdict) before the detailed entries.
3. **Resolution** — a short closing line: either *"All of your assumptions hold."* or the corrected picture in one or two sentences, gathering the denials into what is actually true.
4. **Then answer the prompt.** If the prompt also asked for work or an answer, do it now — built on the corrected facts, never on a denied claim. If a denial makes the request moot or changes what should be done, say so instead of doing the original request blindly.

If the prompt contains no checkable claims at all, say so in one line and answer normally.

## 6. What this skill does not change

- It does not relax any other active instruction or skill. `/replicants:dont` still forbids changes, so verification uses read-only checks only; `/replicants:verb` still governs prose style.
- It does not authorize mutations to *test* a claim. Verify with reads, read-only commands, read-only queries and web searches. If a claim can only be settled by changing something, mark it ❔ UNRESOLVED and describe the check that would settle it.
- It does not license pedantry. Judge the claim the user meant, not an uncharitable reading of loose wording — but when loose wording hides a real misunderstanding, correct the misunderstanding.

## 7. Failure modes to avoid

- **Hedged confirmations** — "that should be right" is not a confirmation. Either it is verified and you say so plainly, or it is not and the verdict is ❔.
- **Soft denials** — "that might not be quite accurate" buries the correction. Say it is not correct, then say what is.
- **Memory verdicts** — confirming or denying a claim about the user's code or systems without looking, or a claim about third-party software or the outside world without searching the web.
- **Missed premises** — answering a question whose built-in assumption is false, without first flagging that it is false.
- **Denial without correction** — every ❌ must end with the accurate statement, not just "that's wrong".
- **Acting on a denied claim** — carrying out the original request as if the false assumption were true.
