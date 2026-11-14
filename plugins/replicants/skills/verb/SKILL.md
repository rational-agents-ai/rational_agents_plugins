---
name: verb
description: Verbose, human-readable final response for the current turn only — written in whole, complete sentences, with every acronym unwound at its first use (each letter mapped to the word it stands for), and assuming the reader has no prior knowledge of the subject. Trigger ONLY when the literal token `/replicants:verb` (or its bare alias `/verb`) appears in the user's current message (at the start, the end, or anywhere in it). Do NOT trigger on plain-English requests such as "explain simply", "no jargon" or "explain like I'm new", and do NOT carry it forward from an earlier message — it must be invoked again on every turn where it is meant to apply.
---

# /replicants:verb — verbose, human-readable final response for this turn

This skill changes **how the final response of the current turn is written**. It does not change what work is done, which tools are used, or what other skills require. When it is active, being helpful means the answer can be understood by an intelligent reader who has never encountered the subject before.

**Scope: the current turn only.** The rules apply to the final response to the prompt that contained `/replicants:verb` (or `/verb`). The next user message returns to normal style unless it invokes the skill again. Never continue writing in this style on a later turn because it was used earlier.

**Coverage: the final response only.** The rules govern the answer shown to the user at the end of the turn. They do not govern interim progress messages, files written, tracker items or comments, commit messages, pull request descriptions, or briefs sent to subagents — those keep their usual style.

## 1. Announce the mode

Open the final response with a single-line banner so the mode is visible in the transcript:

> 📖 **/verb active — this response is written in full sentences, with acronyms unwound and no prior knowledge assumed.**

If another active skill also requires an opening banner (for example `/replicants:dont`), show both banners, one per line, before the body of the response.

## 2. Rule one — whole, complete sentences in prose

- Every paragraph of prose is made of whole, grammatical sentences with a subject and a verb. Do not write telegraphic fragments such as "Fixed. Tests green. Pushed." in running text; write "The defect is fixed, the test suite passes, and the commit has been pushed."
- Prefer plain words over shorthand. Write "because" instead of "b/c", "and" instead of "+", and "approximately" instead of "~" in prose.
- Connect ideas explicitly. Say why something matters and what follows from it, rather than leaving the reader to infer the link.

**Formatting is unrestricted.** Tables, bullet lists, headings, and code blocks may be used freely, and individual bullets or table cells may be short phrases when that reads better. The whole-sentence rule applies to prose paragraphs, not to every cell or list item.

## 3. Rule two — unwind every acronym at its first use

The first time an acronym or initialism appears in the response, expand it so that each letter is visibly mapped to the word it stands for, by **bolding the letter inside each word**, followed by the acronym in parentheses:

> We ask for **H**uman-**I**n-**T**he-**L**oop (HITL) approval before any change is made.
>
> The **A**rchitecture **D**ecision **R**ecord (ADR) describes the design.

After that first use, the bare acronym may be used for the rest of the response.

- **First use is counted per response.** An acronym explained in an earlier turn must be unwound again, because this response must stand on its own.
- **Acronyms that do not map one letter to one word** (for example `PyPI`, `cp312`, `SQLite`, `numba`) cannot be letter-mapped. Spell out what the name means in plain words instead: "PyPI (the Python Package Index) is the public warehouse for Python libraries."
- **Code, identifiers, commands, file paths, and quoted output stay verbatim.** Do not expand acronyms inside code blocks or inline code such as `HITL_GATE` or `docker compose`; explain them in the surrounding prose instead.
- Unwind even common acronyms (API, URL, SQL, CLI, JSON), because the reader is assumed to have no prior knowledge.

## 4. Rule three — assume no prior knowledge

Write for a capable reader who is new to both the subject and this conversation.

- **Define domain terms at first use** in a short clause: "a wheel, which is a prebuilt package ready to install without compiling".
- **Re-establish context rather than pointing at it.** Instead of "as discussed above" or "the ladder from before", briefly restate what the thing is: "the ordered list of installation methods the design tried one after another".
- **Explain why, not just what.** For each important fact, say why it matters to the reader's situation.
- **Build from the ground up.** Introduce the general idea before the specific detail, and the problem before the solution.
- **Give concrete examples** where an abstract statement would otherwise be hard to picture.
- **Keep precision.** Simpler language must not make a statement less accurate. When something is uncertain or unverified, say so plainly.

## 5. What this skill does not change

- It does not relax any other instruction or skill active in the same turn. `/replicants:dont` still forbids changes, `/replicants:qr` still asks its questions first, and so on. This skill only governs the language of the final response.
- It does not require padding. Verbose means complete and self-explanatory, not repetitive. Once a point is clearly made, move on.
- It does not alter code, command output, error text, or quotations, which must be reproduced exactly.

## 6. Failure modes to avoid

- **Drift across turns:** continuing the verbose style on a later message that did not invoke the skill.
- **Silent acronyms:** using an acronym such as ADR, COA, WORM or CMMS without unwinding it at its first use in this response.
- **Assumed context:** referring to earlier conversation ("the fallback we rejected") without restating what it was.
- **Fragmented prose:** writing paragraphs as strings of clipped phrases.
