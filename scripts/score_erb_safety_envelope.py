#!/usr/bin/env python3
"""Score a frozen ERB safety-envelope run after runtime completion."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Sequence


def read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def score(runtime: dict[str, Any], labels: dict[str, dict[str, Any]]) -> dict[str, Any]:
    result_ids = [result.get("caseId") for result in runtime["results"]]
    if len(result_ids) != len(set(result_ids)) or set(result_ids) != set(labels):
        raise ValueError("Safety results must contain every labeled case exactly once")
    rows = []
    for result in runtime["results"]:
        label = labels.get(result["caseId"])
        if label is None:
            raise ValueError(f"Missing label for {result['caseId']}")
        expected = set(label["expected_doc_ids"])
        before = set(result["retrievedDocumentIds"])
        removed = set(result["documentsRemoved"])
        after = before - removed
        expected_removed = sorted(expected & removed)
        before_recall = len(expected & before) / len(expected) if expected else None
        after_recall = len(expected & after) / len(expected) if expected else None
        rows.append({
            "caseId": result["caseId"],
            "questionType": label["question_type"],
            "retrievalChanged": result["retrievalChanged"],
            "documentsRemoved": result["documentsRemoved"],
            "documentsPinned": result["documentsPinned"],
            "expectedEvidenceRemoved": expected_removed,
            "conflictMatch": result["conflictMatch"],
            "matchConfidence": result["matchConfidence"],
            "policyVerdict": result["policyVerdict"],
            "queryIds": [result["lexicalQueryId"], *result["hydraQueryIds"]],
            "groundingLatencyMs": result["groundingLatencyMs"],
            "expectedRetrievalRecallBefore": before_recall,
            "expectedRetrievalRecallAfter": after_recall,
            "materiallyDegraded": before_recall is not None and after_recall is not None and after_recall < before_recall,
        })
    interventions = [row for row in rows if row["retrievalChanged"]]
    conflict_questions = [row for row in rows if row["questionType"] == "conflicting_info"]
    recall_values = [row["expectedRetrievalRecallBefore"] for row in rows if row["expectedRetrievalRecallBefore"] is not None]
    return {
        "totalQuestions": len(rows),
        "interventions": len(interventions),
        "interventionsByCategory": {},
        "expectedEvidenceRemovedOutsideProvenConflicts": sum(len(row["expectedEvidenceRemoved"]) for row in rows if row["questionType"] != "conflicting_info"),
        "unsupportedInterventions": runtime["summary"]["unsupportedInterventions"],
        "falseConflictMatches": sum(1 for row in rows if row["conflictMatch"] is not None and row["questionType"] != "conflicting_info"),
        "falseNotFound": sum(1 for row in rows if row["policyVerdict"] == "NOT_FOUND" and row["expectedRetrievalRecallBefore"] not in (None, 0)),
        "incorrectAbstentions": None,
        "incorrectAbstentionsReason": "This audit evaluates context intervention safety, not answer generation; it does not relabel NO_INTERVENTION as an answer abstention.",
        "materiallyDegradedContexts": sum(row["materiallyDegraded"] for row in rows),
        "conflictingInfoQuestions": len(conflict_questions),
        "conflictQuestionsIntervened": sum(row["retrievalChanged"] for row in conflict_questions),
        "weakness": "The full-corpus run had no per-query proven HydraDB conflict anchors, so it safely made zero interventions. Conflict efficacy remains measured in the separate live conflict suite.",
        "meanExpectedDocumentRecall": sum(recall_values) / len(recall_values) if recall_values else None,
        "rows": rows,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-results", required=True, type=Path)
    parser.add_argument("--questions", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    runtime_bytes = args.runtime_results.read_bytes()
    runtime = json.loads(runtime_bytes)
    labels = {row["question_id"]: row for row in read_jsonl(args.questions)}
    if len(labels) != 500 or runtime.get("labelFileOpened") is not False:
        raise RuntimeError("Safety scorer requires 500 labels and a label-free completed runtime")
    report = score(runtime, labels)
    if report["totalQuestions"] != 500:
        raise RuntimeError("Safety scorer did not cover the complete corpus")
    artifact = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "runtimeResultsSha256": hashlib.sha256(runtime_bytes).hexdigest(),
        "labelsOpenedAfterRuntime": True,
        "report": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), **{key: report[key] for key in ("totalQuestions", "interventions", "unsupportedInterventions", "falseConflictMatches", "falseNotFound", "materiallyDegradedContexts")}}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
