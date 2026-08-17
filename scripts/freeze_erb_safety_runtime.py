#!/usr/bin/env python3
"""Freeze label-free runtime inputs for the complete ERB safety envelope."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Sequence


FORBIDDEN = ("expected_doc_ids", "gold_answer", "answer_facts", "question_type")


def read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"Expected object at {path}:{line_number}")
            yield value


def freeze_cases(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cases = []
    seen = set()
    for row in rows:
        case_id = row.get("question_id")
        question = row.get("question")
        sources = row.get("source_types")
        if not isinstance(case_id, str) or not case_id or case_id in seen:
            raise ValueError(f"Invalid or duplicate question_id: {case_id}")
        if not isinstance(question, str) or not question:
            raise ValueError(f"{case_id} has no question")
        if not isinstance(sources, list) or not all(isinstance(item, str) and item for item in sources):
            raise ValueError(f"{case_id} has invalid source_types")
        seen.add(case_id)
        cases.append({"id": case_id, "question": question, "sourceSystems": sorted(set(sources))})
    return cases


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--questions", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    cases = freeze_cases(list(read_jsonl(args.questions)))
    if len(cases) != 500:
        raise RuntimeError(f"Expected the complete 500-question corpus, got {len(cases)}")
    artifact = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": "Enterprise RAG Bench",
        "datasetRevision": "5665533",
        "labelFree": True,
        "cases": cases,
    }
    serialized = json.dumps(artifact, indent=2, sort_keys=True) + "\n"
    lowered = serialized.casefold()
    if any(field in lowered for field in FORBIDDEN):
        raise RuntimeError("Frozen safety runtime contains evaluation-only fields")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(serialized, encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "cases": len(cases),
        "sha256": hashlib.sha256(serialized.encode()).hexdigest(),
        "labelFree": True,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
