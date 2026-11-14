#!/usr/bin/env python3
"""Pre-flight for /adr-consensus:adr_consensus — validate, resolve and back up an ADR.

Everything the adr-consensus workflow cannot do for itself, because workflow scripts
have no shell and no filesystem access. Runs in one call so the checks gate the
commit: nothing is ever committed for a run that then fails to launch.

  1. FLAGS    rounds: and churn: are integers >= 1; each per-run model flag is one of
              the allowed models (case-insensitive). Refused, never coerced.
  2. MODELS   read <project root>/.claude/adr-consensus/quorum.json; any seat value
              outside the model set refuses, naming the seat and the file. Resolve the
              seat → model map: per-run flag > quorum.json > built-in default.
  3. RESOLVE  a reference (absolute / relative / bare name) to exactly one file
  4. GIT      confirm it lives in a git repository
  5. FORMAT   confirm the three canonical ADR sections are present and in order
  6. SEATS    load the four seat contracts (reviewer, architect, sweeper, arbiter)
  7. BACKUP   (--commit) path-scoped commit — including first-time tracking of a
              brand-new ADR — yielding a baseline sha

Exit 0 with {"ok": true, ...} only when the workflow is safe to launch. Any failure
exits non-zero with a reason and NEVER commits.

Read-only mode:
  preflight.py --check-format <path>
      Runs only step 5 on one file. Never touches git. Exit 0 when the document is in
      the canonical three-section format, 1 otherwise.

Usage:
  preflight.py "docs/adr/PAYMENTS_RETRY.md" --commit
  preflight.py "PAYMENTS_RETRY" --commit --rounds 3 --churn 2 --sweeper opus
  preflight.py --check-format docs/adr/PAYMENTS_RETRY.md

Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, NoReturn, Sequence

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:  # isolated interpreters do not add the script dir
    sys.path.insert(0, str(SCRIPTS_DIR))
sys.dont_write_bytecode = True  # never write __pycache__ into the installed plugin

import quorum  # noqa: E402  (sibling module: the seat catalog and quorum.json rules)

SEATS_DIR = quorum.SEATS_DIR
CONTRACT_NAMES = ("reviewer", "architect", "sweeper", "arbiter")
FORMAT_SKILL = "/adr-consensus:adr_format"
DEFAULT_ROUNDS = 7
DEFAULT_CHURN = 2
LOUD_ROUNDS_ABOVE = 10
ARBITER_AGENT = "general-purpose"
ARBITER_MODEL = "session model"  # not configurable: the arbiter runs on the session's model
_POSITIVE_INT = re.compile(r"^[0-9]+$")
_SKIP_DIRS = frozenset({".git", "node_modules", ".venv", "venv", "__pycache__"})

# The canonical format from /adr-consensus:adr_format: exactly three `##` sections, in order.
REQUIRED_SECTIONS = (
    ("## 1. Problem Space", "1. Problem Space"),
    ("## 2. Solution", "2. Solution"),
    ("## 3. Plan", "3. Plan"),
)


class Refusal(Exception):
    """A reason not to launch. Carries extra JSON fields for the report."""

    def __init__(self, reason: str, **extra: Any) -> None:
        super().__init__(reason)
        self.reason = reason
        self.extra = extra


def fail(reason: str, **extra: Any) -> NoReturn:
    raise Refusal(reason, **extra)


def git(args: Sequence[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=False)


# --------------------------------------------------------------------------- flags


def positive_int(name: str, raw: str | None, default: int) -> int:
    """An integer >= 1, or a refusal naming what was wrong. Never coerced."""
    if raw is None:
        return default
    value = raw.strip()
    if not _POSITIVE_INT.match(value):
        fail(f"{name}:{raw} is not a whole number. {name}: takes an integer >= 1, "
             f"e.g. {name}:3. Nothing was launched.", flag=name, value=raw)
    number = int(value)
    if number < 1:
        fail(f"{name}:{raw} must be at least 1 — a zero-round run would produce a verdict "
             f"nobody debated. Nothing was launched.", flag=name, value=raw)
    return number


def model_overrides(catalog: quorum.SeatCatalog, given: dict[str, str | None]) -> dict[str, str]:
    """Validated per-run model flags, keyed by seat id."""
    overrides: dict[str, str] = {}
    for seat in catalog.seats:
        raw = given.get(seat.id)
        if raw is None:
            continue
        model = catalog.normalize_model(raw)
        if model is None:
            fail(f"{seat.flag}:{raw} is not an allowed model. The {seat.label} seat takes one "
                 f"of {', '.join(catalog.models)}. Nothing was launched.",
                 seat=seat.id, flag=seat.flag, value=raw)
        overrides[seat.id] = model
    return overrides


def resolve_seat_models(catalog: quorum.SeatCatalog, root: Path,
                        overrides: dict[str, str]) -> tuple[quorum.QuorumFile, quorum.Resolution]:
    try:
        qfile = quorum.read_quorum(quorum.quorum_path(root))
    except quorum.ConfigError as exc:
        fail(f"{exc}. Fix or delete it (or run /adr-consensus:quorum_select). Nothing was launched.")
    problems = quorum.seat_problems(catalog, qfile)
    if problems:
        p = problems[0]
        fail(f"seat {p['seat']} in {p['file']} is set to {p['value']}, which is not one of "
             f"{', '.join(catalog.models)} (lower-case). Fix the file or run "
             f"/adr-consensus:quorum_select. Nothing was launched.",
             seat=p["seat"], file=p["file"], problems=problems)
    return qfile, quorum.resolve_models(catalog, qfile, overrides)


# --------------------------------------------------------------------------- resolve


def clean_reference(ref: str) -> str:
    ref = ref.strip().strip("\"'")
    if ref.startswith("file:"):
        ref = ref[5:].strip().strip("\"'")
    if ref.startswith("@"):
        ref = ref[1:]
    return ref


def _matches_in(roots: Sequence[Path], ref: str) -> list[Path]:
    hits: list[Path] = []
    for base in roots:
        for path in (base / ref, base / Path(ref).name):
            if path.is_file() and (real := path.resolve()) not in hits:
                hits.append(real)
    return hits


def _matches_below(root: Path, name: str) -> list[Path]:
    hits: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in _SKIP_DIRS and not d.startswith("."))
        if name in filenames:
            hits.append((Path(dirpath) / name).resolve())
    return hits


def resolve(ref: str, cwd: Path, root: Path) -> Path:
    """Turn a reference into exactly one file, or refuse. Ambiguity is never guessed.

    Absolute paths (``@`` and ``~`` tolerated) are taken as given. Relative and bare
    names are looked up in the cwd, the project root and its ``docs/``; failing that,
    by file name anywhere in the project root.
    """
    ref = clean_reference(ref)
    if not ref:
        fail("no ADR reference given. Usage: /adr-consensus:adr_consensus file:<ADR_MARKDOWN>")
    if not ref.endswith(".md"):
        ref += ".md"

    candidate = Path(ref).expanduser()
    if candidate.is_absolute():
        if not candidate.is_file():
            fail(f"no such file: {candidate}")
        return candidate.resolve()

    roots = list(dict.fromkeys(p.resolve() for p in (cwd, root, root / "docs") if p.is_dir()))
    hits = _matches_in(roots, ref) or _matches_below(root, Path(ref).name)
    if len(hits) > 1:
        fail(f"{ref!r} is ambiguous — it matches {len(hits)} files. Re-run with the path "
             f"to the one you mean.", matches=[str(p) for p in hits])
    if not hits:
        fail(f"could not resolve {ref!r} from the current directory or anywhere in the "
             f"project root {root}", searched=[str(p) for p in roots])
    return hits[0]


# --------------------------------------------------------------------------- format


def check_format(adr: Path) -> dict[str, Any]:
    """Confirm the three canonical ADR sections are present and correctly ordered."""
    text = adr.read_text()
    lines = text.splitlines()
    found: dict[str, int] = {}
    for i, line in enumerate(lines, start=1):
        stripped = line.strip()
        for heading, label in REQUIRED_SECTIONS:
            # Tolerate trailing text after the heading, but require the exact stem.
            if label not in found and stripped.startswith(heading):
                found[label] = i
    missing = [label for _, label in REQUIRED_SECTIONS if label not in found]
    positions = [found[label] for _, label in REQUIRED_SECTIONS if label in found]
    order_ok = not missing and positions == sorted(positions)
    return {
        "sections": {label: found.get(label) for _, label in REQUIRED_SECTIONS},
        "missing": missing,
        "order_ok": order_ok,
        "ok": not missing and order_ok,
        "lines": len(lines),
        "bytes": len(text.encode()),
    }


def require_format(adr: Path) -> dict[str, Any]:
    fmt = check_format(adr)
    if fmt["missing"]:
        fail(f"{adr.name} is not in the canonical ADR format — missing "
             f"{', '.join(fmt['missing'])}. The review rubric assumes these three sections, so "
             f"every round would score it against a shape it does not have. Run {FORMAT_SKILL} "
             f"on it first.", adr=str(adr), format=fmt)
    if not fmt["order_ok"]:
        fail(f"{adr.name} has all three sections but not in the required order (Problem Space, "
             f"Solution, Plan). Run {FORMAT_SKILL} on it first.", adr=str(adr), format=fmt)
    return fmt


# --------------------------------------------------------------------------- seats


def load_contracts(seats_dir: Path = SEATS_DIR) -> dict[str, str]:
    """The four seat contracts, verbatim. The workflow cannot read files, so they travel in args."""
    contracts: dict[str, str] = {}
    for name in CONTRACT_NAMES:
        path = seats_dir / f"{name}.md"
        text = path.read_text() if path.is_file() else ""
        if not text.strip():
            fail(f"seat contract missing or empty: {path}")
        contracts[name] = text
    return contracts


# --------------------------------------------------------------------------- backup


def backup(adr: Path, repo: Path, commit: bool) -> dict[str, Any]:
    """Path-scoped baseline commit. Never `git add -A`, never `commit -a`, never push."""
    tracked = git(["ls-files", "--error-unmatch", "--", str(adr)], repo).returncode == 0
    dirty = bool(git(["status", "--short", "--", str(adr)], repo).stdout.strip())
    action = "already-clean"
    if commit and dirty:
        add = git(["add", "--", str(adr)], repo)
        if add.returncode != 0:
            fail(f"git add failed: {add.stderr.strip()}", adr=str(adr))
        verb = "initial baseline" if not tracked else "baseline"
        msg = f"adr-consensus: {verb} before automated revision rounds ({adr.name})"
        done = git(["commit", "-m", msg, "--", str(adr)], repo)
        if done.returncode != 0:
            fail(f"git commit failed: {done.stderr.strip() or done.stdout.strip()}", adr=str(adr))
        action = "committed-untracked" if not tracked else "committed"
    elif dirty:
        state = "is untracked" if not tracked else "has uncommitted changes"
        fail(f"{adr.name} {state} and --commit was not passed. Refusing to launch against an "
             f"unbacked document.", adr=str(adr), tracked=tracked)

    head = git(["rev-parse", "HEAD"], repo)
    if head.returncode != 0:
        fail(f"could not read HEAD: {head.stderr.strip()}", adr=str(adr))
    sha = head.stdout.strip()
    rel = adr.relative_to(repo)
    # A sha that cannot restore the ADR is not a backup; reporting one would be worse than none.
    if git(["cat-file", "-e", f"{sha}:{rel.as_posix()}"], repo).returncode != 0:
        fail(f"baseline {sha[:7]} does not contain {rel} — refusing to report a backup that "
             f"cannot restore the document.", adr=str(adr))
    return {
        "baseline_sha": sha,
        "backup_action": action,
        "was_tracked": tracked,
        "restore_command": f"git checkout {sha} -- {rel.as_posix()}",
    }


# --------------------------------------------------------------------------- modes


def run_check_format(raw: str, cwd: Path) -> dict[str, Any]:
    ref = clean_reference(raw)
    path = Path(ref).expanduser()
    path = path if path.is_absolute() else cwd / path
    if not path.is_file() and path.with_name(path.name + ".md").is_file():
        path = path.with_name(path.name + ".md")
    if not path.is_file():
        fail(f"no such file: {path}")
    fmt = check_format(path)
    result = {"ok": fmt["ok"], "adr": str(path.resolve()), "format": fmt}
    if not fmt["ok"]:
        result["reason"] = (f"missing {', '.join(fmt['missing'])}" if fmt["missing"]
                            else "sections out of order (Problem Space, Solution, Plan)")
    return result


def run_preflight(args: argparse.Namespace, catalog: quorum.SeatCatalog, cwd: Path) -> dict[str, Any]:
    # 1. flags — before anything touches the filesystem or git.
    max_rounds = positive_int("rounds", args.rounds, DEFAULT_ROUNDS)
    churn_limit = positive_int("churn", args.churn, DEFAULT_CHURN)
    overrides = model_overrides(catalog, {s.id: getattr(args, s.id) for s in catalog.seats})

    # 2. models
    root = quorum.project_root(cwd)
    qfile, resolution = resolve_seat_models(catalog, root, overrides)

    # 3-5. resolve, git, format
    if args.reference is None:
        fail("no ADR reference given. Usage: /adr-consensus:adr_consensus file:<ADR_MARKDOWN>")
    adr = resolve(args.reference, cwd, root)
    top = git(["rev-parse", "--show-toplevel"], adr.parent)
    if top.returncode != 0:
        fail(f"{adr} is not inside a git repository. This run rewrites the document repeatedly; "
             f"without git there is no baseline commit, no diff to review and no clean revert. "
             f"Nothing was launched.", adr=str(adr))
    repo = Path(top.stdout.strip())
    fmt = require_format(adr)

    # 6. seats — before the backup, like the format check.
    contracts = load_contracts()

    # 7. backup
    baseline = backup(adr, repo, args.commit)

    warnings = []
    agents = len(catalog.seats) * max_rounds + 1
    if max_rounds > LOUD_ROUNDS_ABOVE:
        warnings.append(f"rounds:{max_rounds} can run up to {agents} agents; state this before launching")
    return {
        "ok": True,
        "adr": str(adr),
        "repo": str(repo),
        "branch": git(["rev-parse", "--abbrev-ref", "HEAD"], repo).stdout.strip() or None,
        "relpath": adr.relative_to(repo).as_posix(),
        **baseline,
        "format": fmt,
        "max_rounds": max_rounds,
        "churn_limit": churn_limit,
        "worst_case_agents": agents,
        "quorum_file": str(qfile.path),
        "quorum_file_exists": qfile.exists,
        # Passed to the workflow verbatim as args.seatModels.
        "seat_models": quorum.seat_models_arg(catalog, resolution.models),
        "seat_map": [
            {"seat": s.id, "label": s.label, "agent": s.agent,
             "model": resolution.models[s.id], "source": resolution.sources[s.id]}
            for s in catalog.seats
        ] + [{"seat": "arbiter", "label": "Arbiter", "agent": ARBITER_AGENT,
              "model": ARBITER_MODEL, "source": "fixed"}],
        "warnings": warnings,
        # Verbatim seat contracts, passed to the workflow as args.seats.
        "seats": contracts,
    }


def build_parser(catalog: quorum.SeatCatalog) -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Pre-flight for /adr-consensus:adr_consensus.")
    ap.add_argument("reference", nargs="?", help="any resolvable reference to the ADR markdown")
    ap.add_argument("--check-format", metavar="PATH", default=None,
                    help="read-only: validate only the three-section format of PATH")
    ap.add_argument("--commit", action="store_true",
                    help="path-scoped commit of the ADR, producing the baseline sha")
    ap.add_argument("--rounds", default=None, help="rounds: as typed (integer >= 1, default 7)")
    ap.add_argument("--churn", default=None, help="churn: as typed (integer >= 1, default 2)")
    for seat in catalog.seats:
        ap.add_argument(f"--{seat.flag}", dest=seat.id, default=None,
                        help=f"{seat.label} model for this run ({', '.join(catalog.models)})")
    return ap


def main(argv: Sequence[str] | None = None) -> int:
    try:
        catalog = quorum.load_catalog()
    except quorum.ConfigError as exc:
        print(json.dumps({"ok": False, "reason": str(exc)}, indent=2))
        return 1
    args = build_parser(catalog).parse_args(argv)
    cwd = Path.cwd()
    try:
        result = (run_check_format(args.check_format, cwd) if args.check_format is not None
                  else run_preflight(args, catalog, cwd))
    except Refusal as exc:
        print(json.dumps({"ok": False, "reason": exc.reason, **exc.extra}, indent=2))
        return 1
    print(json.dumps(result, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
