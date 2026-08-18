#!/usr/bin/env python3
"""Run label-free retrieval and conservative grounding over all ERB questions."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence


STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does",
    "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "to",
    "was", "were", "what", "when", "where", "which", "who", "why", "with",
}


def lexical_query(question: str) -> str:
    tokens = [token.casefold() for token in re.findall(r"[A-Za-z0-9_][A-Za-z0-9_.-]*", question)]
    selected = [token for token in tokens if token not in STOPWORDS and len(token) > 1][:24]
    return " ".join(selected) or "enterprise"


def version_candidates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(str(row["docId"]), []).append(row)
    return [
        {"docId": doc_id, "rowIds": [item["rowId"] for item in group], "sourceSystems": sorted({item["sourceSystem"] for item in group})}
        for doc_id, group in sorted(grouped.items())
        if len(group) > 1
    ]


def build_conflict_anchors(
    extractions: dict[str, Any], conflict_runtime: dict[str, Any]
) -> list[dict[str, Any]]:
    if conflict_runtime.get("labelFree") is not True:
        raise ValueError("Conflict anchors must come from a label-free runtime")
    native_by_source: dict[str, str] = {}
    for case in extractions.get("cases", []):
        for extraction in case.get("extractions", []):
            source_id = str(extraction.get("sourceObjectId", ""))
            native_id = str(extraction.get("sourceNativeId", ""))
            if not source_id or not native_id:
                continue
            prior = native_by_source.setdefault(source_id, native_id)
            if prior != native_id:
                raise ValueError(f"Source object {source_id} maps to multiple native IDs")
    anchors = []
    for case in conflict_runtime.get("cases", []):
        graph = case.get("graph", {})
        conflict_ids = [native_by_source.get(str(value)) for value in graph.get("conflictDocumentIds", [])]
        current_ids = [native_by_source.get(str(value)) for value in graph.get("currentDocumentIds", [])]
        superseded_ids = [native_by_source.get(str(value)) for value in graph.get("supersededDocumentIds", [])]
        query_ids = [str(value) for value in graph.get("hydraQueryIds", [])]
        if len(conflict_ids) != 2 or any(value is None for value in conflict_ids) or len(query_ids) != 2:
            raise ValueError("Every conflict anchor requires two mapped sources and two Hydra query receipts")
        if any(value is None for value in [*current_ids, *superseded_ids]):
            raise ValueError("Conflict lifecycle IDs must map to native sources")
        native_conflicts = sorted(str(value) for value in conflict_ids)
        anchor_id = "conflict-anchor-" + hashlib.sha256("\0".join(native_conflicts).encode()).hexdigest()[:24]
        anchors.append({
            "id": anchor_id,
            "conflictDocumentIds": native_conflicts,
            "currentDocumentIds": sorted(str(value) for value in current_ids),
            "supersededDocumentIds": sorted(str(value) for value in superseded_ids),
            "hydraQueryIds": query_ids,
        })
    anchor_ids = [anchor["id"] for anchor in anchors]
    if len(anchor_ids) != len(set(anchor_ids)):
        raise ValueError("Conflict anchor IDs must be unique")
    return anchors


def discover_conflict_anchor(
    retrieved_document_ids: list[str], anchors: list[dict[str, Any]]
) -> dict[str, Any] | None:
    retrieved = set(retrieved_document_ids)
    matches = [anchor for anchor in anchors if set(anchor["conflictDocumentIds"]).issubset(retrieved)]
    return matches[0] if len(matches) == 1 else None


def apply_conflict_policy(
    retrieved_document_ids: list[str], anchor: dict[str, Any] | None
) -> dict[str, Any]:
    if anchor is None:
        return {
            "retrievalChanged": False,
            "documentsRemoved": [],
            "documentsPinned": [],
            "conflictMatch": None,
            "matchConfidence": None,
            "policyVerdict": "NO_INTERVENTION",
            "hydraQueryIds": [],
            "unsupportedIntervention": False,
            "reason": "No unique complete source-derived conflict anchor matched; fail closed by preserving the context unchanged.",
        }
    current = list(anchor["currentDocumentIds"])
    superseded = list(anchor["supersededDocumentIds"])
    if len(current) != 1 or len(superseded) != 1:
        return {
            "retrievalChanged": False,
            "documentsRemoved": [],
            "documentsPinned": [],
            "conflictMatch": anchor["id"],
            "matchConfidence": 1.0,
            "policyVerdict": "DISPUTED",
            "hydraQueryIds": list(anchor["hydraQueryIds"]),
            "unsupportedIntervention": False,
            "reason": "One complete source-derived conflict anchor matched, but HydraDB has no controlling current source; preserve both records.",
        }
    retrieved = set(retrieved_document_ids)
    if not set([*current, *superseded]).issubset(retrieved):
        raise ValueError("Resolved conflict policy cannot modify a context missing its anchor sources")
    return {
        "retrievalChanged": True,
        "documentsRemoved": superseded,
        "documentsPinned": current,
        "conflictMatch": anchor["id"],
        "matchConfidence": 1.0,
        "policyVerdict": "SUPPORTED",
        "hydraQueryIds": list(anchor["hydraQueryIds"]),
        "unsupportedIntervention": False,
        "reason": "One complete resolved source-derived conflict anchor matched the retrieved source IDs.",
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--extractions", required=True, type=Path)
    parser.add_argument("--conflict-runtime", required=True, type=Path)
    parser.add_argument("--top-k", type=int, default=20)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.top_k < 1 or args.top_k > 50:
        raise ValueError("--top-k must be between 1 and 50")
    runtime_bytes = args.runtime.read_bytes()
    runtime = json.loads(runtime_bytes)
    if runtime.get("labelFree") is not True or len(runtime.get("cases", [])) != 500:
        raise ValueError("Safety runtime must be the complete label-free corpus")
    serialized_runtime = runtime_bytes.decode("utf-8").casefold()
    if any(field in serialized_runtime for field in ("expected_doc_ids", "gold_answer", "answer_facts", "question_type")):
        raise ValueError("Safety runtime contains evaluation labels")
    extraction_bytes = args.extractions.read_bytes()
    conflict_runtime_bytes = args.conflict_runtime.read_bytes()
    conflict_runtime = json.loads(conflict_runtime_bytes)
    serialized_conflicts = conflict_runtime_bytes.decode("utf-8").casefold()
    if any(field in serialized_conflicts for field in ("expected_doc_ids", "gold_answer", "answer_facts", "question_type")):
        raise ValueError("Conflict runtime contains evaluation labels")
    anchors = build_conflict_anchors(json.loads(extraction_bytes), conflict_runtime)
    try:
        import duckdb
    except ImportError as error:
        raise RuntimeError("duckdb is required; install requirements-data.txt") from error
    extension_directory = __import__("os").environ.get("SOURCETRUCE_DUCKDB_EXTENSION_DIRECTORY")
    config = {"extension_directory": extension_directory} if extension_directory else {}
    connection = duckdb.connect(str(args.database), read_only=True, config=config)
    connection.execute("INSTALL fts")
    connection.execute("LOAD fts")
    results = []
    for case in runtime["cases"]:
        started = time.perf_counter()
        query = lexical_query(case["question"])
        sources = case["sourceSystems"]
        source_clause = "" if not sources else f" AND source_type IN ({','.join('?' for _ in sources)})"
        rows = connection.execute(
            "SELECT row_id, doc_id, source_type, title, "
            "fts_main_documents.match_bm25(row_id, ?) AS score FROM documents "
            f"WHERE score IS NOT NULL{source_clause} ORDER BY score DESC, row_id LIMIT ?",
            [query, *sources, args.top_k],
        ).fetchall()
        retrieved = [
            {"rowId": row[0], "docId": row[1], "sourceSystem": row[2], "title": row[3], "score": row[4]}
            for row in rows
        ]
        candidates = version_candidates(retrieved)
        retrieved_document_ids = [row["docId"] for row in retrieved]
        policy = apply_conflict_policy(
            retrieved_document_ids,
            discover_conflict_anchor(retrieved_document_ids, anchors),
        )
        elapsed_ms = (time.perf_counter() - started) * 1000
        query_id = "lexical-" + hashlib.sha256(
            json.dumps({"runtime": runtime.get("datasetRevision"), "case": case["id"], "query": query, "sources": sources, "topK": args.top_k}, sort_keys=True).encode()
        ).hexdigest()[:32]
        results.append({
            "caseId": case["id"],
            "lexicalQueryId": query_id,
            "topK": args.top_k,
            "retrievedRows": len(retrieved),
            "retrievedDocumentIds": retrieved_document_ids,
            "retrievedSourceSystems": sorted({row["sourceSystem"] for row in retrieved}),
            "versionCandidates": candidates,
            "groundingLatencyMs": elapsed_ms,
            **policy,
        })
    connection.close()
    query_ids = [row["lexicalQueryId"] for row in results]
    if len(set(query_ids)) != len(query_ids):
        raise RuntimeError("Safety-envelope query IDs are not unique")
    artifact = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "runtimeSha256": hashlib.sha256(runtime_bytes).hexdigest(),
        "extractionsSha256": hashlib.sha256(extraction_bytes).hexdigest(),
        "conflictRuntimeSha256": hashlib.sha256(conflict_runtime_bytes).hexdigest(),
        "labelFileOpened": False,
        "databaseBytes": args.database.stat().st_size,
        "topK": args.top_k,
        "policy": "Discover a conflict only when one complete source-derived anchor is present in retrieved source IDs. Remove one superseded source only when HydraDB identifies exactly one controlling current source; otherwise preserve context.",
        "summary": {
            "totalQuestions": len(results),
            "interventions": sum(row["retrievalChanged"] for row in results),
            "conflictMatches": sum(row["conflictMatch"] is not None for row in results),
            "resolvedConflictMatches": sum(row["retrievalChanged"] for row in results),
            "unsupportedInterventions": sum(row["unsupportedIntervention"] for row in results),
            "versionCandidates": sum(len(row["versionCandidates"]) for row in results),
            "uniqueQueryIds": len(set(query_ids)),
        },
        "results": results,
    }
    if len(results) != 500 or artifact["summary"]["unsupportedInterventions"] != 0 or artifact["summary"]["interventions"] == 0:
        raise RuntimeError("Safety-envelope runtime verification failed")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), **artifact["summary"], "labelFileOpened": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
