#!/usr/bin/env python3
"""Seat → model configuration for adr-consensus: the seat catalog and quorum.json.

One module owns every rule about which model fills which seat, so /adr_consensus
(through preflight.py) and /quorum_select can never disagree:

  * the seat catalog — seat ids, agents, default models and the allowed model set —
    comes from ``seats/seats.json``, never from a second copy in code;
  * ``<project root>`` is ``git rev-parse --show-toplevel`` in the cwd, or the cwd
    itself outside a git repository;
  * ``<project root>/.claude/adr-consensus/quorum.json`` is read strictly (any seat
    value outside the model set refuses, naming the seat and the file), and rewritten
    atomically with unknown keys preserved.

Model resolution, highest priority first: per-run flag, quorum.json, built-in default.

CLI (used by the /quorum_select skill):

  quorum.py questions [--root DIR]
      The current seat → model map and the four AskUserQuestion questions, as JSON.
  quorum.py write [--root DIR] --set SEAT=ANSWER [--set SEAT=ANSWER ...]
      Validate each answer, merge into quorum.json and write it atomically. An answer
      that is not one of the allowed models leaves that seat unchanged and is reported
      under "rejected". Exits 1 only when the file cannot be read or written.

Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

SCRIPTS_DIR = Path(__file__).resolve().parent
SEATS_DIR = SCRIPTS_DIR.parent / "seats"
SEATS_FILE = SEATS_DIR / "seats.json"
QUORUM_RELPATH = Path(".claude") / "adr-consensus" / "quorum.json"
QUORUM_VERSION = 1
CURRENT_SUFFIX = " (current)"
ARBITER_NOTE = "The arbiter is not configurable: it runs on the session's model."


class ConfigError(Exception):
    """A configuration file that exists but cannot be used. The message names it."""


# --------------------------------------------------------------------------- domain


@dataclass(frozen=True)
class Seat:
    id: str
    label: str
    flag: str
    contract: str
    agent: str
    default_model: str


@dataclass(frozen=True)
class SeatCatalog:
    """The four configurable seats and the allowed models, in seats.json order."""

    seats: tuple[Seat, ...]
    models: tuple[str, ...]

    @property
    def seat_ids(self) -> tuple[str, ...]:
        return tuple(s.id for s in self.seats)

    def seat(self, seat_id: str) -> Seat | None:
        return next((s for s in self.seats if s.id == seat_id), None)

    def normalize_model(self, raw: object) -> str | None:
        """A case-insensitive exact model name, lower-cased; None for anything else."""
        if not isinstance(raw, str):
            return None
        value = raw.strip().lower()
        return value if value in self.models else None

    def defaults(self) -> dict[str, str]:
        return {s.id: s.default_model for s in self.seats}


def load_catalog(path: Path = SEATS_FILE) -> SeatCatalog:
    try:
        doc = json.loads(path.read_text())
        models = tuple(str(m) for m in doc["models"])
        seats = tuple(
            Seat(
                id=seat_id,
                label=str(spec["label"]),
                flag=str(spec["flag"]),
                contract=str(spec["contract"]),
                agent=str(spec["agent"]),
                default_model=str(spec["default_model"]),
            )
            for seat_id, spec in doc["seats"].items()
        )
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise ConfigError(f"cannot read the seat catalog {path}: {exc}") from exc
    for s in seats:
        if s.default_model not in models:
            raise ConfigError(f"seat {s.id!r} in {path} defaults to {s.default_model!r}, "
                              f"which is not one of {', '.join(models)}")
    return SeatCatalog(seats=seats, models=models)


@dataclass(frozen=True)
class QuorumFile:
    """quorum.json as found on disk: its path and raw document ({} when missing)."""

    path: Path
    exists: bool
    document: dict[str, Any]

    @property
    def seats(self) -> dict[str, Any]:
        seats = self.document.get("seats")
        return seats if isinstance(seats, dict) else {}


def seat_problems(catalog: SeatCatalog, quorum: QuorumFile) -> list[dict[str, str]]:
    """Every known seat whose quorum.json value is not an allowed (lower-case) model."""
    problems = []
    for seat_id in catalog.seat_ids:
        if seat_id in quorum.seats and quorum.seats[seat_id] not in catalog.models:
            problems.append({
                "seat": seat_id,
                "value": json.dumps(quorum.seats[seat_id]),
                "file": str(quorum.path),
            })
    return problems


def configured_models(catalog: SeatCatalog, quorum: QuorumFile) -> dict[str, str]:
    """Seat → model from quorum.json where valid, else the default. Unknown keys ignored."""
    return {
        seat_id: value if (value := quorum.seats.get(seat_id)) in catalog.models else default
        for seat_id, default in catalog.defaults().items()
    }


@dataclass(frozen=True)
class Resolution:
    models: dict[str, str]
    sources: dict[str, str]


def resolve_models(
    catalog: SeatCatalog, quorum: QuorumFile, overrides: Mapping[str, str]
) -> Resolution:
    """Flag > quorum.json > default, per seat. Callers validate overrides and the file first."""
    models: dict[str, str] = {}
    sources: dict[str, str] = {}
    for seat in catalog.seats:
        if seat.id in overrides:
            models[seat.id], sources[seat.id] = overrides[seat.id], "flag"
        elif quorum.seats.get(seat.id) in catalog.models:
            models[seat.id], sources[seat.id] = quorum.seats[seat.id], "quorum.json"
        else:
            models[seat.id], sources[seat.id] = seat.default_model, "default"
    return Resolution(models=models, sources=sources)


def seat_models_arg(catalog: SeatCatalog, models: Mapping[str, str]) -> dict[str, dict[str, str]]:
    """The workflow's ``seatModels`` argument: seat id → {agentType, model}."""
    return {s.id: {"agentType": s.agent, "model": models[s.id]} for s in catalog.seats}


def questions(catalog: SeatCatalog, current: Mapping[str, str]) -> list[dict[str, Any]]:
    """The four AskUserQuestion questions: current model first, labelled (current)."""
    out = []
    for seat in catalog.seats:
        now = current[seat.id]
        ordered = [now, *(m for m in catalog.models if m != now)]
        out.append({
            "question": f"Which model should fill the {seat.label} seat?",
            "header": seat.label,
            "multiSelect": False,
            "options": [
                {
                    "label": m + (CURRENT_SUFFIX if m == now else ""),
                    "description": ("Keep the current model" if m == now
                                    else f"Switch {seat.label} to {m}")
                                   + (" (built-in default)" if m == seat.default_model else ""),
                }
                for m in ordered
            ],
        })
    return out


@dataclass(frozen=True)
class Selection:
    accepted: dict[str, str]
    rejected: list[dict[str, str]]


def interpret_answers(catalog: SeatCatalog, answers: Mapping[str, str]) -> Selection:
    """Exact model names only (case-insensitive, the option's "(current)" label allowed).

    Anything else — an "Other" free-text answer that is not a model — is rejected and
    never guessed or fuzzy-matched.
    """
    accepted: dict[str, str] = {}
    rejected: list[dict[str, str]] = []
    for seat_id, raw in answers.items():
        if catalog.seat(seat_id) is None:
            rejected.append({"seat": seat_id, "answer": raw, "reason": "unknown seat id"})
            continue
        text = raw.strip()
        if text.lower().endswith(CURRENT_SUFFIX):
            text = text[: -len(CURRENT_SUFFIX)]
        model = catalog.normalize_model(text)
        if model is None:
            rejected.append({
                "seat": seat_id, "answer": raw,
                "reason": f"not one of {', '.join(catalog.models)}; seat left unchanged",
            })
        else:
            accepted[seat_id] = model
    return Selection(accepted=accepted, rejected=rejected)


def merged_document(quorum: QuorumFile, accepted: Mapping[str, str], updated: str) -> dict[str, Any]:
    """The rewrite: unknown keys (top-level and per-seat) kept, chosen seats replaced."""
    doc = dict(quorum.document)
    seats = dict(quorum.seats)
    seats.update(accepted)
    doc["version"] = QUORUM_VERSION
    doc["seats"] = seats
    doc["updated"] = updated
    return doc


def utc_timestamp(now: datetime | None = None) -> str:
    moment = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return moment.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------- infrastructure


def project_root(cwd: Path) -> Path:
    """``git rev-parse --show-toplevel`` in cwd, or cwd itself outside a repository."""
    try:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=cwd,
                             capture_output=True, text=True, check=False)
    except OSError:
        return cwd.resolve()
    return Path(top.stdout.strip()) if top.returncode == 0 and top.stdout.strip() else cwd.resolve()


def quorum_path(root: Path) -> Path:
    return root / QUORUM_RELPATH


def read_quorum(path: Path) -> QuorumFile:
    """Missing → empty. Present but unreadable, not JSON, or not an object → ConfigError."""
    if not path.exists():
        return QuorumFile(path=path, exists=False, document={})
    try:
        doc = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise ConfigError(f"cannot read {path}: {exc}") from exc
    if not isinstance(doc, dict):
        raise ConfigError(f"{path} must hold a JSON object")
    if "seats" in doc and not isinstance(doc["seats"], dict):
        raise ConfigError(f"{path}: \"seats\" must be a JSON object of seat id → model")
    return QuorumFile(path=path, exists=True, document=doc)


def write_atomic(path: Path, document: Mapping[str, Any]) -> None:
    """Temp file in the same directory, then rename: readers never see a partial file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".quorum-", suffix=".json", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(document, fh, indent=2)
            fh.write("\n")
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


# --------------------------------------------------------------------------- interface


def _table(catalog: SeatCatalog, models: Mapping[str, str]) -> list[dict[str, str]]:
    return [{"seat": s.id, "label": s.label, "agent": s.agent, "model": models[s.id]}
            for s in catalog.seats]


def cmd_questions(catalog: SeatCatalog, root: Path) -> dict[str, Any]:
    quorum = read_quorum(quorum_path(root))
    current = configured_models(catalog, quorum)
    return {
        "ok": True,
        "file": str(quorum.path),
        "exists": quorum.exists,
        "current": _table(catalog, current),
        "invalid": seat_problems(catalog, quorum),
        "questions": questions(catalog, current),
        "arbiter": ARBITER_NOTE,
    }


def cmd_write(catalog: SeatCatalog, root: Path, answers: Mapping[str, str]) -> dict[str, Any]:
    quorum = read_quorum(quorum_path(root))
    selection = interpret_answers(catalog, answers)
    document = merged_document(quorum, selection.accepted, utc_timestamp())
    write_atomic(quorum.path, document)
    written = read_quorum(quorum.path)
    return {
        "ok": True,
        "file": str(quorum.path),
        "seats": _table(catalog, configured_models(catalog, written)),
        "accepted": selection.accepted,
        "rejected": selection.rejected,
        "invalid": seat_problems(catalog, written),
        "updated": document["updated"],
        "arbiter": ARBITER_NOTE,
    }


def _parse_answers(pairs: Sequence[str]) -> dict[str, str]:
    answers: dict[str, str] = {}
    for pair in pairs:
        seat_id, sep, answer = pair.partition("=")
        if not sep:
            raise ConfigError(f"--set expects SEAT=ANSWER, got {pair!r}")
        answers[seat_id.strip()] = answer
    return answers


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Read or write <project root>/.claude/adr-consensus/quorum.json.")
    sub = ap.add_subparsers(dest="command", required=True)
    for name in ("questions", "write"):
        p = sub.add_parser(name)
        p.add_argument("--root", type=Path, default=None,
                       help="project root (default: git toplevel of the cwd, else the cwd)")
        if name == "write":
            p.add_argument("--set", action="append", default=[], metavar="SEAT=ANSWER",
                           help="one seat's answer; repeat per seat")
    args = ap.parse_args(argv)
    try:
        catalog = load_catalog()
        root = args.root.resolve() if args.root else project_root(Path.cwd())
        result = (cmd_questions(catalog, root) if args.command == "questions"
                  else cmd_write(catalog, root, _parse_answers(args.set)))
    except (ConfigError, OSError) as exc:
        print(json.dumps({"ok": False, "reason": str(exc)}, indent=2))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
