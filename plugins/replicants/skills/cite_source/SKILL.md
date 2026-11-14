---
name: cite_source
description: Source-backed answering mode. While active, every assertion the orchestrator agent OR any subagent makes must be researched and evidenced with fresh lookups — web search for anything about the outside world, fresh tool reads for anything about the user's own systems — and cited with the links/URLs (or file:line) that support it; nobody may answer solely from existing conversation/chat context or memory. Takes an optional positional toggle. `/replicants:cite_source` with no toggle = active for the CURRENT turn only. `/replicants:cite_source on` = active for the rest of the conversation. `/replicants:cite_source off` = disabled for the rest of the conversation. The toggle is idempotent. Trigger when the user runs /replicants:cite_source [on|off], when the literal token `/replicants:cite_source` appears in a message, or when the user asks to "cite sources", "back every claim with links", "show your sources", or "don't answer from memory" (natural-language requests = current turn only).
---

# /replicants:cite_source — every assertion researched, evidenced, and linked

While this mode is active, **no claim is made from memory or from conversation context alone.** Every assertion in a response, from the orchestrator and from every subagent, is backed by evidence from a fresh lookup. The source is shown: a URL for web evidence, or a `file_path:line_number` or command output for local evidence.

## 0. Invocation, toggle, and lifetime

### Parse the argument

In this file `/replicants:cite_source` stands for either spelling of the invocation: the namespaced `/replicants:cite_source` or its short alias `/cite_source`. Treat them identically, including when finding the most recent toggle.

Look only at the **first whitespace-separated token** after `/replicants:cite_source`, matched case-insensitively:

| Invocation | Effect |
|---|---|
| `/replicants:cite_source` (no argument, or a first token that is not `on`/`off`) | **Current turn only.** Active for this turn; the session toggle is untouched. Any remaining text is the user's request. |
| `/replicants:cite_source on` | **Session toggle = ON.** Active for this turn and every later turn of the conversation. |
| `/replicants:cite_source off` | **Session toggle = OFF.** Disabled from this turn on, for the rest of the conversation. |

`on` and `off` are toggles only as the first token: `/replicants:cite_source on what port does X use?` sets ON and then answers the question cited. `/replicants:cite_source what is on port 80?` is a bare invocation (first token `what`). A natural-language request ("cite your sources for this") counts as a bare invocation.

### What "current turn" covers

A turn starts with the user's message and ends when the user sends the next one. It includes all work done to answer that message: every tool call, and **every subagent dispatched during the turn, even a background one that finishes after the user's next message**. Such an agent was launched with the citation directive (§6), so its report must still be sourced and audited before it is relayed.

### Determining whether the mode is active this turn

The state lives **in the conversation only**. Nothing is written to disk, so nothing carries into another session. On every turn, work it out this way:

1. Find the **most recent** `/replicants:cite_source on` or `/replicants:cite_source off` in the user's messages this conversation. That is the session toggle. If there is none, the toggle is **OFF** (the default).
2. The mode is **active this turn** if the toggle is ON, **or** the current message is a bare `/replicants:cite_source` invocation.

Consequences, all intended:

- **Idempotent.** `on` sets ON whatever the prior state was; `off` sets OFF whatever the prior state was. Sending the same toggle twice, or ten times, leaves the same state as sending it once. Only the most recent explicit toggle counts, never how many there were.
- **A bare call never changes the toggle.** If the toggle is OFF, a bare call activates this turn and the next turn is OFF again. If the toggle is ON, a bare call is a no-op and the mode stays on.
- **A later explicit toggle always wins** over an earlier one.

If the conversation was compacted and the summary no longer shows the latest toggle, use the summary's record of the state if it has one. Otherwise treat the toggle as OFF and say once that the user can re-send `/replicants:cite_source on`.

### Toggle confirmation (idempotent output)

When a toggle is invoked, reply with the **same fixed line whatever the prior state was**. Do not say "already on" or "now on":

- `on` → `🔗 /replicants:cite_source is ON for the rest of this conversation.`
- `off` → `⏹️ /replicants:cite_source is OFF for the rest of this conversation.`

If the toggle came with no other request, that line is the whole response. If a request follows it, put the line first, then answer: cited if ON, uncited if OFF.

## 1. Banner

Open every response the mode is active for with one of these:

- Current turn only: `> 🔗 **/replicants:cite_source active (this turn) — every assertion below is researched and cited.**`
- Session toggle ON: `> 🔗 **/replicants:cite_source active (session) — every assertion below is researched and cited.**`

If another active skill also requires a banner (`/replicants:dont`, `/replicants:verb`, `/replicants:confirm_deny`), show every banner, one per line.

## 2. What counts as an assertion

An assertion is anything stated as true that the user could be wrong to rely on:

- Facts about software, libraries, APIs, CLIs, versions, defaults, limits, pricing, standards, laws, codes, people, organizations, events, numbers and dates.
- Facts about the user's own code, files, configuration, databases, services and machine.
- Claims *recalled from earlier in this conversation*, including a subagent's earlier report, a summary, or your own earlier statement. **Earlier context is a lead, not evidence**: check it again before restating it as fact.

These are not assertions and need no source: questions, plans and proposals labelled as such, the user's own stated preferences, arithmetic or logic shown step by step, and descriptions of what you are *about to* do.

## 3. How to evidence each assertion

| Assertion is about | Evidence required | Cite as |
|---|---|---|
| The outside world (third-party software, docs, APIs, standards, prices, news, any public fact) | **`WebSearch`**, then **`WebFetch`** the page that actually decides the claim | `[n]` → URL in the Sources list |
| The user's code, files, config | Fresh `Read` / `Grep` / `Glob` this turn | `file_path:line_number` |
| How a local command, service or system behaves now | Read-only `Bash` (`--version`, `--help`, `git log`, `curl` to read-only endpoints) | the command + the relevant output line |
| Data | Read-only queries (`SELECT`, `EXPLAIN`) / other read-only tool calls | the query + the row |

Rules:

- **Search, don't recall.** Run the lookup even when you are confident. Confidence from training data is exactly what this mode forbids relying on.
- **Start with a focused `WebSearch`.** Broaden or rephrase when results are thin, off-target or possibly stale, or when the fact is niche, recent, a price, or about availability. Send independent searches in the same turn, in parallel.
- **Read the page, not just the snippet.** Cite a search snippet only when the snippet itself states the claim. Otherwise `WebFetch` the page and confirm it says what you say it says.
- **Primary sources first.** Prefer official docs, changelogs, specifications, standards bodies, and the vendor's or project's own site or repo over blogs, forums and aggregators. When sources disagree, say so, cite both, and side with the most authoritative and most recent.
- **Never fabricate or reconstruct a URL.** Cite only URLs that a `WebSearch` result or `WebFetch` in this session actually returned. No guessed paths, and no "it's probably at docs.x.com/…".
- **Date-sensitive facts** (prices, versions, limits, deprecations, availability) carry the page's date or "accessed <today's date>".
- **Local facts get local evidence.** The web cannot prove what is in the user's repo; a fresh read can. Do not cite a web page for a claim about the user's own system. Do not cite the user's code for a claim about how a third-party tool behaves in general.

## 4. When evidence cannot be found

Do not drop the claim silently, and do not state it as fact. Either:

- **leave it out**, if the answer stands without it, or
- **label it** inline: `⚠️ UNVERIFIED — searched <what>, found no source that confirms this.` Give your best understanding only if it is clearly marked as unverified.

Never treat an unverified claim as verified because it "is well known".

## 5. Response format

1. The banner (§1).
2. The answer, with an inline marker on every sourced sentence. Use `[1]`, `[2]`, … for web sources, and an inline `path:line` or the command for local evidence. One marker can cover a sentence; a sentence with two independent facts needs two.
3. A closing **Sources** section listing every web source actually used:

   ```
   ## Sources
   1. [Page title](https://full.url/exact/page) — what it supports (accessed 2026-11-04)
   2. ...
   ```

4. If anything is unverified, a one-line **Unverified** list naming those claims.

Every `[n]` in the body must appear in Sources, and every entry in Sources must be used in the body.

## 6. Subagents: propagate the mode to every one

Subagents do **not** see this skill, so the orchestrator must pass it on. This applies to every agent dispatched in a turn where the mode is active.

1. **Inject the directive.** Every `Agent` / `Workflow` agent prompt written in an active turn must include this block word for word near the top. The same goes for a `SendMessage` continuation of an existing agent.

   ```
   CITE_SOURCE MODE IS ACTIVE. Do not answer from memory or from the context you were given alone.
   Every assertion in your report must be backed by a lookup you ran yourself:
   - outside-world facts: WebSearch, then WebFetch the deciding page; cite the URL.
   - the user's code/config/systems: a fresh Read/Grep/Bash/read-only query; cite path:line or the command output.
   Cite only URLs a WebSearch or WebFetch actually returned to you; never construct or guess one.
   Mark anything you could not verify as "UNVERIFIED".
   End your report with a "Sources" list of every URL you used and what each supports.
   ```

   Agents dispatched in an inactive turn get no directive.
2. **Match the agent to the evidence.** Before dispatching work that needs web evidence, check the agent type's tool list. If it lacks `WebSearch`/`WebFetch` (in this plugin, `replicants:qa` and `replicants:qa_worker`), choose one of two options. Either dispatch a web-capable type instead (`replicants:analyst`, `replicants:analyst-worker`, `replicants:architect`, `replicants:codie`, `replicants:deploy`, or a general-purpose agent), or keep the agent on local evidence only and run the web verification yourself afterwards.
3. **Audit what comes back.** A subagent's report is input, not evidence. This holds even when the report arrives in a later turn, if the agent was dispatched in an active turn. Before relaying any of its claims:
   - Reject claims that arrive without a source, or verify them yourself.
   - Spot-check its URLs: `WebFetch` at least the sources behind the claims the user will rely on most. Drop any URL that does not load or does not support the claim.
   - Carry its surviving sources into your own Sources list. You are answerable for every citation you relay.
4. **Forks** (`subagent_type: "fork"`) inherit your context, including this skill. Put the directive in the prompt anyway, so it is explicit.

## 7. What this skill does not change

- It does not relax any other instruction or skill. Under `/replicants:dont`, research is still read-only. Never put a secret into a search query or a fetched URL, and never print a secret value as evidence.
- It does not authorize changing anything to produce evidence. If a claim can only be settled by changing something, mark it UNVERIFIED and describe the check that would settle it.
- It does not require citations for trivial conversational text ("Done.", "Here's the plan:"). It requires them for *claims*.

## 8. Failure modes to avoid

- **Memory answers dressed up with citations**: writing the answer first, then searching for a link that roughly matches. Research first, then write what the sources say.
- **Phantom URLs**: any link not returned by a tool in this session.
- **Snippet-only citations** for claims the snippet does not actually state.
- **Context recycling**: restating an earlier turn's or a subagent's claim as fact without checking it again.
- **Unpropagated subagents**: dispatching an agent in an active turn without the §6 directive, or relaying its unsourced claims.
- **Silent drops**: omitting a claim you could not verify when the user asked about it directly. Say it is unverified instead.
- **Toggle errors**: letting a bare call change the session toggle; carrying a bare call into the next turn; forgetting a session `on` on later turns; or making the toggle reply depend on the prior state.
