#!/usr/bin/env python3
"""Open canonical ERB holdout labels only after the execution artifact is frozen."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from fetch_erb_evidence import holdout_target_rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--questions", required=True, type=Path)
    parser.add_argument("--execution", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    execution = json.loads(args.execution.read_text(encoding="utf-8"))
    if execution.get("state") != "executed" or not execution.get("executionDigest"):
        raise ValueError("labels may only be opened after an executed holdout is sealed")
    labels = []
    for row in holdout_target_rows(args.questions):
        not_found = row["question_type"] == "info_not_found"
        facts = row.get("answer_facts")
        documents = row.get("expected_doc_ids")
        if not isinstance(facts, list) or not all(isinstance(item, str) for item in facts):
            raise ValueError(f"{row.get('question_id')} has invalid answer_facts")
        if not isinstance(documents, list) or not all(isinstance(item, str) for item in documents):
            raise ValueError(f"{row.get('question_id')} has invalid expected_doc_ids")
        labels.append({
            "caseId": row["question_id"],
            "expectedVerdict": "NOT_FOUND" if not_found else "SUPPORTED",
            "expectedFacts": [] if not_found else [{"kind": "text", "value": fact} for fact in facts],
            "expectedEvidenceDocumentIds": [] if not_found else documents,
            "expectedRelationships": [] if not_found else ["ASSERTS", "SUPPORTED_BY"],
            "forbiddenRelationships": [],
            "requiredCoverageState": "partial",
            "expectedConflictState": "not_applicable",
            "requiredGraphProof": ({
                "sourceLabel": "Entity",
                "targetLabel": "SourceObject",
                "requiredRelationships": ["ASSERTS", "SUPPORTED_BY"],
                "minimumPathLength": 2,
                "maximumPathLength": 2,
                "requireLiveQueryId": True,
            } if not not_found else {
                "requiredRelationships": [],
                "requireLiveQueryId": False,
            }),
            "expectedIdentityState": "not_applicable",
            "expectedAlignmentState": "not_applicable",
        })
    artifact = {
        "schemaVersion": 2,
        "openedAt": datetime.now(timezone.utc).isoformat(),
        "executionDigest": execution["executionDigest"],
        "noTuningDeclaration": "Runtime code, corpus, prompts, retrieval, policies, and attempts were frozen before this file was emitted.",
        "labels": labels,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "labels": len(labels), "executionDigest": execution["executionDigest"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
