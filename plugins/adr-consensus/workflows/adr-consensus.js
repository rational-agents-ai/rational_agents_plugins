export const meta = {
  name: 'adr-consensus',
  description: 'Multi-round ADR review to a plain-language readiness verdict: two seated reviewers judge readiness, an architect makes scoped revisions or rebuts, a sweeper audits scope and fixes local inconsistencies, an arbiter writes the verdict',
  whenToUse: 'Prefer the /adr-consensus:adr_consensus skill, which pre-flights, resolves the seat models and backs up first. Direct args: {adr: "/abs/path/ADR.md", baselineSha: "<git sha>", seats: {reviewer, architect, sweeper, arbiter} (contract texts), seatModels: {reviewer_1, reviewer_2, architect, sweeper} each {agentType, model}, stateDir: "/abs/dir for sweeper snapshots", repo?: "/abs/repo", maxRounds?: 7, churnLimit?: 2, sustainQuorum?: 1, revise?: true}. baselineSha, seats, seatModels and stateDir are REQUIRED.',
  phases: [
    { title: 'Review' },
    { title: 'Revise' },
    { title: 'Sweep' },
    { title: 'Verdict' },
  ],
}

// ---------------------------------------------------------------------------
// SEATS, NOT AGENTS
//
// The run is defined by four seat contracts. What each seat may and must do lives in
// its contract (the plugin's skills/adr_consensus/seats/<seat>.md), which the skill
// passes in as args.seats. Which agent and model fill each seat arrive as
// args.seatModels, keyed by seat id (reviewer_1, reviewer_2, architect, sweeper); the
// skill's pre-flight resolves them (per-run flag > quorum.json > default). The arbiter
// is always the built-in general-purpose agent on the session's model. This script
// owns only orchestration: the loop, the docket, the diff basis, the consensus rule
// and the verdict computation. Any model may fill any seat, the same one in all four.
//
//   REVIEWERS    two seats (reviewer_1, reviewer_2); judge implementation readiness;
//                never edit.
//   ARCHITECT    answers the docket with scoped edits, or rebuts on the record.
//   SWEEPER      audits the revision's scope against its edit map, keeps the whole
//                document (Problem Space / Solution / Plan) consistent, fixes the
//                obvious in place, escalates design decisions to the docket.
//   ARBITER      seated once; explains the computed verdict in the verdict file.
//
// Seats communicate only through structured artifacts this script passes between
// them (findings -> docket -> revisions/rebuttals -> edit map -> sweep edits ->
// changes list -> verdict). No seat messages another directly: reviewers must stay
// independent, every hand-off must be on the record the verdict reports, and resume
// replays calls by prompt.
//
// Convergence comes from the ADR being FIXED or a finding being REBUTTED, not from
// reviewers arguing each other down. Scope discipline exists because of an observed
// ratchet: revisions that over-answer a finding add surface the next round finds new
// gaps in, and the run exhausts its cap one self-inflicted finding at a time.
// ---------------------------------------------------------------------------

const adr = args?.adr
if (!adr) throw new Error('adr-consensus: pass args {adr: "/abs/path/to/ADR.md"}')

// The backup belongs to the /adr-consensus:adr_consensus skill, which has a shell. What stays
// here is the GATE: this workflow rewrites the ADR in place, so it refuses to start
// unless the caller can name the commit the document is restorable from.
const baselineSha = typeof args?.baselineSha === 'string' ? args.baselineSha.trim() : ''
if (!/^[0-9a-f]{7,40}$/.test(baselineSha)) {
  return {
    adr,
    verdict: 'ABORTED',
    stopReason: 'no-baseline',
    headline: 'ABORTED — no git baseline supplied, so nothing was run and the document is untouched.',
    detail: 'This workflow rewrites the ADR in place and will not start without a commit '
      + 'to restore it from. Pass baselineSha, or invoke the /adr-consensus:adr_consensus skill, which '
      + 'resolves the reference, validates the ADR format and takes the backup for you.',
    received: args?.baselineSha ?? null,
  }
}

// Same gate for the role definitions. Without a contract a seat has no defined
// duty, and the agent would fall back to its own mandate — the coupling seats
// exist to remove. The skill's pre-flight reads the contracts and resolves the
// seat models; this script still refuses anything it cannot run as given.
const SEAT_NAMES = ['reviewer', 'architect', 'sweeper', 'arbiter']
const REVIEWER_SEATS = ['reviewer_1', 'reviewer_2']
const SEAT_IDS = [...REVIEWER_SEATS, 'architect', 'sweeper']
const MODELS = ['opus', 'fable', 'sonnet', 'haiku']
const ARBITER_AGENT = 'general-purpose'
const seats = args?.seats || {}
const seatModels = args?.seatModels || {}
const missingSeats = SEAT_NAMES.filter(s => typeof seats[s] !== 'string' || !seats[s].trim())
const seatModelProblems = []
for (const id of SEAT_IDS) {
  const s = seatModels[id]
  if (!s || typeof s !== 'object') { seatModelProblems.push(`${id} (missing)`); continue }
  if (typeof s.agentType !== 'string' || !s.agentType.trim()) seatModelProblems.push(`${id} (empty agentType)`)
  if (!MODELS.includes(s.model)) seatModelProblems.push(`${id} (model ${JSON.stringify(s.model ?? null)} not in ${MODELS.join(', ')})`)
}
if (missingSeats.length || seatModelProblems.length) {
  return {
    adr,
    verdict: 'ABORTED',
    stopReason: 'no-seats',
    headline: 'ABORTED — seat contracts or seat models not supplied, so nothing was run and the document is untouched.',
    detail: 'Pass args.seats {reviewer, architect, sweeper, arbiter} with the contract texts and '
      + 'args.seatModels {reviewer_1, reviewer_2, architect, sweeper}, each {agentType, model} with a '
      + `model in {${MODELS.join(', ')}}, or invoke the /adr-consensus:adr_consensus skill, whose `
      + 'pre-flight loads the contracts and resolves the seat models.',
    missingSeats,
    seatModelProblems,
  }
}

// Sweeper snapshots live outside the repository, in the directory the skill names
// (the plugin's data directory). An unsubstituted placeholder is refused rather than
// handed to a shell to guess at.
const stateDir = typeof args?.stateDir === 'string' ? args.stateDir.trim().replace(/\/+$/, '') : ''
if (!stateDir || stateDir.includes('${')) {
  return {
    adr,
    verdict: 'ABORTED',
    stopReason: 'no-state-dir',
    headline: 'ABORTED — no state directory supplied for sweeper snapshots, so nothing was run and the document is untouched.',
    detail: 'Pass args.stateDir as an absolute directory outside the repository, or invoke the '
      + '/adr-consensus:adr_consensus skill, which passes the plugin data directory.',
    received: args?.stateDir ?? null,
  }
}

const maxRounds = args?.maxRounds ?? 7
// SUSTAIN votes a docket item needs to stay open.
const sustainQuorum = args?.sustainQuorum ?? 1
const revise = args?.revise ?? true
// Consecutive rounds in which every reviewer reported READY with an empty docket and
// only the confirming sweep reopened the round (escalated findings or substantive
// edits). Reaching it stops the run READY, with the sweeper's open items listed as
// consistency fixes rather than spending the remaining rounds on them.
const churnLimit = args?.churnLimit ?? 2
const DEADLOCK_AT = 2

// Seats are keyed by seat id, never by agent or model: the same model may fill every seat.
const reviewerPanel = REVIEWER_SEATS
const panelSize = reviewerPanel.length
const seatOf = id => ({ agentType: seatModels[id].agentType.trim(), model: seatModels[id].model })
const describeSeat = id => `${id} = ${seatOf(id).agentType} on ${seatOf(id).model}`
const seatMap = Object.fromEntries(SEAT_IDS.map(id => [id, seatOf(id)]))
// Docket keys are namespaced by who raised them: reviewers by seat id, sweeper
// escalations by the sweeper seat.
const SWEEPER_KEY = 'sweeper'

const slash = adr.lastIndexOf('/')
const adrDir = adr.slice(0, slash)
const adrStem = adr.slice(slash + 1).replace(/\.md$/, '')
const repoRoot = typeof args?.repo === 'string' && args.repo.trim() ? args.repo.trim() : adrDir
// Full stem, NOT adrStem.split('_')[0]: a shared prefix would collapse different
// ADRs onto one verdict file and silently overwrite it.
const verdictPath = `${adrDir}/${adrStem}_CONSENSUS_VERDICT.md`

// Per-round diff basis for the sweeper's scope audit. Round 1's architect starts
// from the baseline commit (reviewers never edit), so its diff is against git. After
// each sweep the sweeper snapshots the document; the next round's architect starts
// from exactly that text. Snapshots live outside the repository, under args.stateDir.
// `round` = the round whose end state it captures.
const snapshotDir = `${stateDir}/${adrStem}-${baselineSha.slice(0, 12)}`
let diffBasis = { kind: 'git', ref: baselineSha, round: 0 }
function diffCommand(basis) {
  return basis.kind === 'git'
    ? `git -C "${adrDir}" diff ${basis.ref} -- "${adr}"`
    : `git diff --no-index -- "${basis.path}" "${adr}"   # exit status 1 just means "differences found"`
}

// Every seated call starts with its contract, verbatim. Contract text is part of the
// prompt, so editing a contract correctly invalidates resume caching for that seat.
function seated(seat, filledBy, task) {
  return `You are seated as ${seat.toUpperCase()} in an /adr-consensus:adr_consensus review, filled by ${filledBy}.
The seat contract below governs your scope, permissions and output for this task, and
overrides your default mandate wherever they conflict. Your own expertise still applies
within it.

<seat-contract seat="${seat}">
${seats[seat].trim()}
</seat-contract>

${task}`
}

// --- Output schemas (the orchestration contract; seat contracts reference them) ---

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['verdict', 'blocking', 'docket_rulings'],
  properties: {
    verdict: { type: 'string', enum: ['READY', 'NOT_READY'] },
    blocking: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'section', 'objection', 'fix'],
        properties: {
          id: { type: 'string', description: 'short kebab-case slug, stable across rounds' },
          section: { type: 'string' },
          objection: { type: 'string', description: 'the question an implementer would be forced to ask' },
          fix: { type: 'string', description: 'the concrete edit that resolves it' },
          evidence: { type: 'string', description: 'path:line, ADR section + quote, or source URL' },
        },
      },
    },
    docket_rulings: {
      type: 'array',
      description: 'one ruling for EVERY docket item supplied; [] if no docket',
      items: {
        type: 'object',
        required: ['id', 'ruling', 'reason'],
        properties: {
          id: { type: 'string', description: 'echo the docket key EXACTLY, including its prefix' },
          ruling: { type: 'string', enum: ['SUSTAIN', 'WITHDRAW'] },
          reason: { type: 'string', description: 'where a rebuttal exists, engage it directly — say why it fails, or concede' },
        },
      },
    },
  },
}

const REVISION_SCHEMA = {
  type: 'object',
  required: ['applied', 'rebutted'],
  properties: {
    applied: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'change', 'edits'],
        properties: {
          id: { type: 'string', description: 'the docket key EXACTLY as bracketed' },
          change: { type: 'string', description: 'what was actually edited, concretely' },
          edits: {
            type: 'array',
            description: 'EVERY location edited for this finding',
            items: {
              type: 'object',
              required: ['location', 'lines_added', 'lines_removed', 'why_required', 'expansion_warranted'],
              properties: {
                location: { type: 'string', description: 'section heading path plus approximate line range after the edit' },
                lines_added: { type: 'integer' },
                lines_removed: { type: 'integer' },
                why_required: { type: 'string', description: 'how this specific edit answers the finding' },
                expansion_warranted: { type: 'boolean', description: 'true if this edit adds new content (subsection, table, schema, endpoint, env var, function, test, example, rules section)' },
                justification: { type: 'string', description: 'required when expansion_warranted: why a smaller edit would not close the gap' },
              },
            },
          },
        },
      },
    },
    rebutted: {
      type: 'array',
      description: 'findings you decline, with the argument. Never silently skip one.',
      items: {
        type: 'object',
        required: ['id', 'argument', 'recorded_in_adr'],
        properties: {
          id: { type: 'string', description: 'the docket key EXACTLY as bracketed' },
          argument: { type: 'string', description: 'why the finding is wrong, already answered, or out of scope' },
          evidence: { type: 'string', description: 'ADR section, path:line or source URL supporting the rebuttal' },
          recorded_in_adr: { type: 'boolean', description: 'true if written into the ADR Rebuttals table' },
        },
      },
    },
  },
}

const SWEEP_EDIT_KINDS = ['trim_overscope', 'fix_reference', 'fix_contradiction', 'fix_unsupported']
// At the confirming sweep these kinds leave consensus intact: they remove text or
// repair a pointer, so reviewers are not certifying anything new.
const CONFIRM_SAFE_EDIT_KINDS = ['trim_overscope', 'fix_reference']

const SWEEP_SCHEMA = {
  type: 'object',
  required: ['consistent', 'diff_audited', 'edits_made', 'contradictions', 'hollow_fixes', 'unsupported', 'snapshot_written'],
  properties: {
    consistent: { type: 'boolean', description: 'true if, after your own edits, nothing remains to escalate' },
    diff_audited: { type: 'boolean', description: 'true if you ran the supplied diff command and audited it against the edit map' },
    edits_made: {
      type: 'array',
      description: 'every edit YOU made to the ADR this sweep; [] if none',
      items: {
        type: 'object',
        required: ['id', 'kind', 'location', 'description', 'lines_added', 'lines_removed'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: SWEEP_EDIT_KINDS },
          location: { type: 'string', description: 'section heading path plus approximate line range' },
          finding_id: { type: 'string', description: 'for trim_overscope: the finding whose edit went beyond what it required, if any' },
          description: { type: 'string', description: 'what was wrong and exactly what you changed' },
          lines_added: { type: 'integer' },
          lines_removed: { type: 'integer' },
        },
      },
    },
    snapshot_written: { type: 'boolean' },
    snapshot_path: { type: 'string', description: 'the expanded absolute path you wrote' },
    contradictions: {
      type: 'array',
      description: 'ESCALATIONS ONLY: contradictions that need a design decision',
      items: {
        type: 'object',
        required: ['id', 'claim_a', 'claim_b', 'fix'],
        properties: {
          id: { type: 'string' },
          claim_a: { type: 'string', description: 'section + the specific claim' },
          claim_b: { type: 'string', description: 'section + the claim that cannot also be true' },
          fix: { type: 'string' },
        },
      },
    },
    hollow_fixes: {
      type: 'array',
      description: 'ESCALATIONS ONLY: findings closed by deleting, weakening or restating, or an expansion justification you consider unsound',
      items: {
        type: 'object',
        required: ['id', 'finding_id', 'what_happened', 'quote'],
        properties: {
          id: { type: 'string' },
          finding_id: { type: 'string' },
          what_happened: { type: 'string', enum: ['deleted', 'weakened', 'restated', 'unjustified_expansion'] },
          quote: { type: 'string' },
        },
      },
    },
    unsupported: {
      type: 'array',
      description: 'ESCALATIONS ONLY: assertions whose removal would open a real gap',
      items: {
        type: 'object',
        required: ['id', 'assertion'],
        properties: { id: { type: 'string' }, assertion: { type: 'string' } },
      },
    },
  },
}

// --- Run data rendered into seat tasks ------------------------------------

const nsKey = (prefix, id) => `${prefix}:${id}`

function docketText(table) {
  if (table.size === 0) return ''
  return [...table.values()].map(o => {
    const lines = [`- [${o.key}] (${o.section}, raised by ${o.raisedBy}): ${o.objection}`,
                   `  Proposed fix: ${o.fix}`]
    if (o.evidence) lines.push(`  Evidence: ${o.evidence}`)
    for (const r of (o.rebuttals || [])) {
      lines.push(`  ARCHITECT REBUTTAL (round ${r.round}): ${r.argument}`)
      if (r.evidence) lines.push(`    evidence: ${r.evidence}`)
    }
    return lines.join('\n')
  }).join('\n')
}

function changesText(changes) {
  if (!changes || (!changes.applied.length && !changes.sweepEdits.length)) return ''
  const lines = ['CHANGES SINCE THE LAST REVIEW ROUND (orientation only; review the whole document as it now stands):']
  for (const a of changes.applied) lines.push(`- architect [${a.id}]: ${a.change}`)
  for (const e of changes.sweepEdits) lines.push(`- sweeper ${e.kind} @ ${e.location}: ${e.description}`)
  return lines.join('\n')
}

function editMapText(applied) {
  return applied.map(a => {
    const edits = (a.edits || []).map(e => {
      const exp = e.expansion_warranted
        ? ` [EXPANSION — justification: ${e.justification ? e.justification : 'NONE GIVEN'}]`
        : ''
      return `    · ${e.location} (+${e.lines_added}/-${e.lines_removed}): ${e.why_required}${exp}`
    }).join('\n')
    return `- [${a.id}] ${a.change}${edits ? `\n${edits}` : '\n    · (no edit map reported — treat every change for this finding as unmapped)'}`
  }).join('\n')
}

function reviewTask(round, table, changes) {
  const docket = docketText(table)
  const changed = changesText(changes)
  return `TASK
ADR: ${adr}
Repository root: ${repoRoot}
Round: ${round}
${changed ? `\n${changed}\n` : ''}
${docket
    ? `LIVE OBJECTION DOCKET — rule on every item in docket_rulings, echoing each key exactly as bracketed:
${docket}

Then list any NEW blocking findings in blocking.`
    : 'No docket: this is an opening review. List blocking findings in blocking and leave docket_rulings empty.'}`
}

function revisionTask(round, table) {
  return `TASK
ADR: ${adr}
Round: ${round}

LIVE OBJECTION DOCKET — answer every item under exactly one of applied or rebutted, using
each key exactly as bracketed:
${docketText(table)}`
}

function sweepTask({ applied, docket, confirming, round, basis }) {
  if (confirming) {
    return `TASK
ADR: ${adr}
Round: ${round}
Mode: CONFIRMING SWEEP — every seated reviewer reports READY with an empty docket.

Edits applied during this run:
${editMapText(applied) || '- (no revisions were applied this run)'}`
  }
  const staleBasis = basis.round !== round - 1
  return `TASK
ADR: ${adr}
Round: ${round}
Mode: POST-REVISION SWEEP

Findings this revision answered (the only reasons the document was allowed to change):
${docket || '- (docket text unavailable)'}

Architect's edit-to-finding map:
${editMapText(applied)}

Diff command:
  ${diffCommand(basis)}
${staleBasis
    ? `Note: no snapshot exists from immediately before this revision, so the diff ALSO contains
changes from earlier rounds that reviewers have already seen. Treat only additions belonging
to THIS round's edit map as candidates for trimming.`
    : (basis.kind === 'git' ? 'This is the first revision of the run; the diff is against the baseline commit.' : '')}

Snapshot command (run after all your edits):
  mkdir -p "${snapshotDir}" && cp "${adr}" "${snapshotDir}/after-r${round}.md"`
}

// --- Rounds -----------------------------------------------------------------
phase('Review')
log(`ADR: ${adr} — up to ${maxRounds} rounds, sustainQuorum ${sustainQuorum}, revise=${revise}`)
log(`Seats: ${SEAT_IDS.map(describeSeat).join('; ')}; arbiter = ${ARBITER_AGENT} on the session model`)

const table = new Map()
const deadlocked = []
const history = []
const allApplied = []
const allSweepEdits = []
// What changed since the reviewers last read the document; shown to them next round.
let pendingChanges = { applied: [], sweepEdits: [] }
let dryRounds = 0
let round = 0
let revisionsMade = 0
let lastRevision = null
let lastSweep = null
let consensus = false
let stopReason = null
let churnRounds = 0
// Filled only when the churn limit stops the run: the sweeper's open items, listed
// and NOT applied, and any substantive confirming-sweep edits no reviewer has read.
let consistencyFixes = []
let unreviewedEdits = []

function admitSweepFindings(sweep, roundNo) {
  let n = 0
  const raisedBy = `sweeper (${seatOf('sweeper').model})`
  const admit = (id, section, objection, fix) => {
    const key = nsKey(SWEEPER_KEY, id)
    if (table.has(key)) return
    table.set(key, { key, id, raisedBy, round: roundNo, rebuttals: [], section, objection, fix })
    n += 1
  }
  for (const c of (sweep?.contradictions || [])) {
    admit(c.id, 'Whole document', `Self-contradiction. ${c.claim_a} — but ${c.claim_b}`, c.fix)
  }
  for (const h of (sweep?.hollow_fixes || [])) {
    admit(h.id, 'Whole document',
      h.what_happened === 'unjustified_expansion'
        ? `Finding "${h.finding_id}" was answered with an expansion whose justification does not hold. Current text: "${h.quote}"`
        : `Finding "${h.finding_id}" was ${h.what_happened}, not resolved. Current text: "${h.quote}"`,
      h.what_happened === 'unjustified_expansion'
        ? 'Close the gap with a smaller edit, or strengthen the justification for the expansion.'
        : 'Resolve by specifying the missing detail, not by removing the text that exposed it.')
  }
  for (const u of (sweep?.unsupported || [])) {
    admit(u.id, 'Whole document',
      `Revision asserts something the document does not establish: ${u.assertion}`,
      'Establish it, or remove the assertion.')
  }
  return n
}

function recordSweepEdits(sweep, roundNo, confirming) {
  const edits = (sweep?.edits_made || []).map(e => ({ ...e, round: roundNo, confirming }))
  allSweepEdits.push(...edits)
  pendingChanges.sweepEdits.push(...edits)
  return edits
}

while (round < maxRounds) {
  round += 1
  const changesForReview = pendingChanges
  pendingChanges = { applied: [], sweepEdits: [] }

  const reviews = (await parallel(reviewerPanel.map(seatId => () =>
    agent(seated('reviewer', describeSeat(seatId), reviewTask(round, table, changesForReview)), {
      label: `r${round}:${seatId}:${seatOf(seatId).model}`, phase: 'Review',
      agentType: seatOf(seatId).agentType, model: seatOf(seatId).model, schema: FINDINGS_SCHEMA,
    }).then(r => r && ({ panelist: seatId, ...r }))
  ))).filter(Boolean)

  if (reviews.length === 0) {
    stopReason = 'reviewers-failed'
    log(`round ${round}: no reviewer reported — abandoning rather than declaring consensus`)
    break
  }
  const allReported = reviews.length >= panelSize
  if (!allReported) {
    const missing = reviewerPanel.filter(p => !reviews.some(r => r.panelist === p))
    log(`WARNING round ${round}: ${missing.join(', ')} did not report; a round without every seated reviewer is not consensus`)
  }

  // Retire docket items no reviewer sustains.
  const sustainVotes = new Map()
  for (const r of reviews) {
    for (const ruling of (r.docket_rulings || [])) {
      if (ruling.ruling === 'SUSTAIN') sustainVotes.set(ruling.id, (sustainVotes.get(ruling.id) || 0) + 1)
    }
  }
  const retired = []
  for (const key of [...table.keys()]) {
    if ((sustainVotes.get(key) || 0) < sustainQuorum) { retired.push(key); table.delete(key) }
  }

  // A finding rebutted DEADLOCK_AT times and still sustained is a real dispute
  // between competent parties. More rounds will not settle it — escalate.
  for (const [key, item] of [...table.entries()]) {
    if ((item.rebuttals?.length || 0) >= DEADLOCK_AT) {
      deadlocked.push({ ...item, sustainedBy: sustainVotes.get(key) || 0 })
      table.delete(key)
      log(`DEADLOCK ${key}: rebutted ${item.rebuttals.length}x, still sustained — escalating to the owner`)
    }
  }

  let added = 0
  for (const r of reviews) {
    for (const b of (r.blocking || [])) {
      const key = nsKey(r.panelist, b.id)
      if (!table.has(key)) { table.set(key, { ...b, key, raisedBy: `reviewer (${r.panelist})`, round, rebuttals: [] }); added += 1 }
    }
  }

  const allReady = allReported && reviews.every(r => r.verdict === 'READY')
  history.push({
    round,
    positions: reviews.map(r => ({ reviewer: r.panelist, verdict: r.verdict })),
    added, retired: retired.length, live: table.size, deadlocked: deadlocked.length,
    revision: lastRevision, sweep: lastSweep,
  })
  log(`Round ${round}: ${reviews.map(r => `${r.panelist}=${r.verdict}`).join(', ')} — +${added} new, -${retired.length} retired, ${table.size} live`)

  // --- Consensus test -------------------------------------------------------
  if (table.size === 0 && allReady) {
    // Every reviewer worked from a finding list. Before declaring the document
    // ready, the sweeper reads it whole and confirms it agrees with itself.
    let substantiveConfirmEdits = []
    if (revisionsMade > 0 || allSweepEdits.length > 0) {
      phase('Sweep')
      const confirm = await agent(seated('sweeper', describeSeat('sweeper'), sweepTask({ applied: allApplied, confirming: true, round })), {
        label: `r${round}:sweeper-confirm:${seatOf('sweeper').model}`, phase: 'Sweep',
        agentType: seatOf('sweeper').agentType, model: seatOf('sweeper').model, schema: SWEEP_SCHEMA,
      })
      lastSweep = confirm
      const edits = recordSweepEdits(confirm, round, true)
      // Trims and reference repairs keep consensus. Anything else changes what the
      // reviewers certified, so they must read it before the run can end READY.
      substantiveConfirmEdits = edits.filter(e => !CONFIRM_SAFE_EDIT_KINDS.includes(e.kind))
      if (edits.length) log(`confirming sweep made ${edits.length} edit(s), ${substantiveConfirmEdits.length} substantive`)
      const reopened = admitSweepFindings(confirm, round)
      if (reopened > 0) {
        log(`confirming sweep escalated ${reopened} finding(s) — consensus withheld`)
        dryRounds = 0
      }
      // Every reviewer is READY and the docket was empty, so anything reopening this
      // round came from the sweeper alone. Consecutive such rounds are churn: each fix
      // exposes a different mismatch, and the stall detector cannot see it because
      // every id is new.
      if (reopened > 0 || substantiveConfirmEdits.length > 0) {
        churnRounds += 1
        log(`sweeper-only reopening ${churnRounds} of ${churnLimit} consecutive`)
        if (churnRounds >= churnLimit) {
          consistencyFixes = [...table.values()]
          unreviewedEdits = substantiveConfirmEdits
          table.clear()
          consensus = true
          stopReason = 'sweeper-churn'
          log(`STOP at round ${round}: ${churnRounds} consecutive sweeper-only reopenings — READY, ${consistencyFixes.length} consistency fix(es) listed, not applied`)
          break
        }
      } else {
        churnRounds = 0
      }
    }
    if (table.size === 0 && substantiveConfirmEdits.length > 0) {
      log('confirming sweep made substantive edits — consensus withheld pending one more review round')
      dryRounds = 0
      if (round >= maxRounds) { stopReason = 'confirm-edits-unreviewed'; break }
      continue
    }
    if (table.size === 0) {
      consensus = true
      stopReason = 'consensus'
      log(`CONSENSUS at round ${round} of ${maxRounds} — all ${panelSize} reviewers READY, docket empty, document self-consistent`)
      break
    }
  } else {
    // A reviewer raised, sustained or still reports NOT_READY: not sweeper churn.
    churnRounds = 0
  }
  if (table.size === 0 && !allReady) {
    log(`round ${round}: docket empty but a reviewer still reports NOT_READY — no work to do, treating as no movement`)
    dryRounds += 1
    if (dryRounds >= 2) { stopReason = 'stalled'; break }
    continue
  }

  dryRounds = (added === 0 && retired.length === 0) ? dryRounds + 1 : 0
  if (dryRounds >= 2) { stopReason = 'stalled'; log('stopping: 2 consecutive rounds with no movement'); break }
  if (!revise) { stopReason = 'revise-disabled'; log('revise=false — reporting findings without editing'); break }
  if (round >= maxRounds) { stopReason = 'round-cap'; break }

  // --- Revise ---------------------------------------------------------------
  phase('Revise')
  const revisedDocket = docketText(table)
  lastRevision = await agent(seated('architect', describeSeat('architect'), revisionTask(round, table)), {
    label: `r${round}:architect:${seatOf('architect').model}`, phase: 'Revise',
    agentType: seatOf('architect').agentType, model: seatOf('architect').model, schema: REVISION_SCHEMA,
  })

  const applied = lastRevision?.applied ?? []
  const rebutted = lastRevision?.rebutted ?? []
  revisionsMade += applied.length
  allApplied.push(...applied.map(a => ({ ...a, round })))
  pendingChanges.applied.push(...applied.map(a => ({ ...a, round })))
  const mappedLines = applied.reduce((n, a) => n + (a.edits || []).reduce((m, e) => m + (e.lines_added || 0) - (e.lines_removed || 0), 0), 0)
  const expansions = applied.reduce((n, a) => n + (a.edits || []).filter(e => e.expansion_warranted).length, 0)
  log(`Round ${round} revision: ${applied.length} applied, ${rebutted.length} rebutted, net ${mappedLines >= 0 ? '+' : ''}${mappedLines} mapped lines, ${expansions} justified expansion(s)`)

  for (const r of rebutted) {
    const item = table.get(r.id) || [...table.values()].find(o => o.id === r.id)
    if (item) {
      item.rebuttals = [...(item.rebuttals || []), { round, argument: r.argument, evidence: r.evidence || '' }]
    } else {
      log(`WARNING: architect rebutted "${r.id}", which is not on the docket — rebuttal not recorded`)
    }
  }

  // --- Sweep ----------------------------------------------------------------
  // Runs whenever the architect may have changed the document: applied findings,
  // or rebuttals written into the ADR's Rebuttals table.
  const documentChanged = applied.length > 0 || rebutted.some(r => r.recorded_in_adr)
  if (documentChanged) {
    phase('Sweep')
    lastSweep = await agent(seated('sweeper', describeSeat('sweeper'), sweepTask({ applied, docket: revisedDocket, confirming: false, round, basis: diffBasis })), {
      label: `r${round}:sweeper:${seatOf('sweeper').model}`, phase: 'Sweep',
      agentType: seatOf('sweeper').agentType, model: seatOf('sweeper').model, schema: SWEEP_SCHEMA,
    })
    const edits = recordSweepEdits(lastSweep, round, false)
    const trimmed = edits.filter(e => e.kind === 'trim_overscope').length
    const reopened = admitSweepFindings(lastSweep, round)
    log(`Round ${round} sweep: diff_audited=${lastSweep?.diff_audited}, ${edits.length} edit(s) in place (${trimmed} over-scope trim(s)), ${reopened} escalated`)
    if (reopened > 0 || edits.length > 0) dryRounds = 0
    if (lastSweep?.snapshot_written && lastSweep?.snapshot_path) {
      diffBasis = { kind: 'file', path: lastSweep.snapshot_path, round }
    } else {
      log(`WARNING round ${round}: sweeper wrote no snapshot — next scope audit will diff against round ${diffBasis.round}'s state`)
    }
  } else {
    lastSweep = null
    // Nothing touched the document, so the existing basis still describes it exactly.
    diffBasis = { ...diffBasis, round }
    log(`Round ${round}: document unchanged by revision, sweep skipped`)
  }

  phase('Review')
}

if (!stopReason) stopReason = 'round-cap'

// --- Verdict ----------------------------------------------------------------
phase('Verdict')

// Computed here, deterministically. The arbiter explains it and cannot change it.
// A deadlock is not a defect in the document — it is a decision only the owner can
// make — so it is reported as neither "ready" nor "the panel found problems".
const verdict = consensus && deadlocked.length === 0 ? 'READY'
  : consensus && deadlocked.length > 0 ? 'NEEDS_DECISION'
  : 'NOT_READY'

const REASON = {
  consensus: `every seated reviewer (${reviewerPanel.join(', ')}) independently reported READY, no objection remained, and the confirming sweep found the document consistent`,
  'round-cap': `the ${maxRounds}-round limit was reached while objections were still live`,
  stalled: 'two consecutive rounds produced no movement — the same objections stood, and nothing new was found or resolved',
  'revise-disabled': 'the run was configured not to edit the document, so findings were reported rather than fixed',
  'reviewers-failed': 'no reviewer returned a result, so no conclusion about readiness could be drawn',
  'confirm-edits-unreviewed': `every reviewer reported READY, but the confirming sweep then made substantive edits no reviewer has read, and the ${maxRounds}-round limit left no round to review them`,
  'sweeper-churn': `every seated reviewer (${reviewerPanel.join(', ')}) reported READY with no objection of their own for ${churnLimit} consecutive rounds, and each time only the confirming sweep reopened the round; the run stopped rather than spend its remaining rounds on consistency fixes, which are listed and were not applied`,
}

const headline = verdict === 'READY' && stopReason === 'sweeper-churn'
  ? `READY FOR IMPLEMENTATION at round ${round} of ${maxRounds} — ${consistencyFixes.length} consistency fix(es) listed${unreviewedEdits.length ? `, ${unreviewedEdits.length} sweep edit(s) unreviewed` : ''}.`
  : verdict === 'READY'
  ? `READY FOR IMPLEMENTATION — consensus reached at round ${round} of ${maxRounds}.`
  : verdict === 'NEEDS_DECISION'
    ? `NOT READY — the panel finished at round ${round}, but ${deadlocked.length} disagreement(s) need your decision.`
    : stopReason === 'confirm-edits-unreviewed'
      ? `NOT READY after ${round} of ${maxRounds} round(s) — all reviewers READY, but final sweep edits are unreviewed.`
      : `NOT READY after ${round} of ${maxRounds} round(s) — ${table.size} unresolved objection(s).`

const restoreCommand = `git checkout ${baselineSha} -- ${adr}`

// The arbiter is fixed: the built-in general-purpose agent, on the session's model (no model passed).
const brief = await agent(seated('arbiter', `${ARBITER_AGENT} on the session model`, `TASK
ADR: ${adr}
Write the verdict document to: ${verdictPath}

Verdict (computed — do not change it): ${verdict}
Headline (use verbatim): ${headline}
Rounds held: ${round} of ${maxRounds}
Seats (seat = agent on model): ${SEAT_IDS.map(describeSeat).join('; ')}; arbiter = ${ARBITER_AGENT} on the session model
Stopped because: ${REASON[stopReason] ?? stopReason}
Baseline commit: ${baselineSha}
Restore command: ${restoreCommand}

Round history (JSON):
${JSON.stringify(history, null, 2)}

Unresolved blocking objections (JSON):
${JSON.stringify([...table.values()], null, 2)}

Deadlocked — rebutted ${DEADLOCK_AT}x by the architect and still sustained (JSON):
${JSON.stringify(deadlocked, null, 2)}

Everything the architect applied, with its edit-to-finding map (JSON):
${JSON.stringify(allApplied, null, 2)}

Everything the sweeper edited in place; \`confirming\` marks the confirming sweep (JSON):
${JSON.stringify(allSweepEdits, null, 2)}

Consistency fixes — the sweeper's open items when the churn limit stopped the run; listed, NOT applied; empty unless stopped for sweeper churn (JSON):
${JSON.stringify(consistencyFixes, null, 2)}

Substantive confirming-sweep edits already in the document that no reviewer has read; empty unless stopped for sweeper churn (JSON):
${JSON.stringify(unreviewedEdits, null, 2)}`),
  { label: 'arbiter', phase: 'Verdict', agentType: ARBITER_AGENT })

return {
  adr,
  verdict,
  headline,
  stopReason,
  reason: REASON[stopReason] ?? stopReason,
  consensusReached: consensus,
  roundsHeld: round,
  maxRounds,
  churnLimit,
  consistencyFixes,
  unreviewedEdits,
  seatModels: seatMap,
  seats: { ...seatMap, arbiter: { agentType: ARBITER_AGENT, model: null } },
  reviewerPanel,
  unresolvedCount: table.size,
  deadlockedCount: deadlocked.length,
  liveBlocking: [...table.values()],
  deadlocked,
  byRaiser: [...reviewerPanel.map(p => `reviewer (${p})`), `sweeper (${seatOf('sweeper').model})`].map(p => ({
    raisedBy: p,
    live: [...table.values()].filter(o => o.raisedBy === p).length,
  })),
  changesApplied: allApplied,
  sweepEdits: allSweepEdits,
  verdictDocument: verdictPath,
  baselineSha,
  restoreCommand,
  history,
  summary: brief,
}
