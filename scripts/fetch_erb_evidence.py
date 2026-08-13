#!/usr/bin/env python3
"""Acquire a bounded, canonical Enterprise RAG Bench evidence slice.

Selection labels stay in this acquisition process. The emitted JSONL contains
only the four canonical document fields consumed by the runtime adapter.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator, Sequence


DATASET_ID = "onyx-dot-app/EnterpriseRAG-Bench"
DATASET_CONFIG = "documents"
DATASET_SPLIT = "test"
DATASET_URL = "https://huggingface.co/datasets/onyx-dot-app/EnterpriseRAG-Bench"
ALIGNMENT_TERMS = ("owner", "assignee", "reporter", "reviewer", "responsible")
PERSON_NAME = re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b")


@dataclass(frozen=True)
class EvidenceSelection:
    mode: str
    question_ids: tuple[str, ...]
    document_ids: tuple[str, ...]
    selection_rule: str


def _read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"invalid JSON at {path}:{line_number}") from error
            if not isinstance(row, dict):
                raise ValueError(f"expected object at {path}:{line_number}")
            yield row


def _selection_from_rows(
    rows: Iterable[dict[str, Any]],
    *,
    mode: str,
    rule: str,
    include: Callable[[dict[str, Any]], bool],
) -> EvidenceSelection:
    question_ids: list[str] = []
    document_ids: list[str] = []
    seen_questions: set[str] = set()
    seen_documents: set[str] = set()
    for row in rows:
        if not include(row):
            continue
        question_id = row.get("question_id")
        expected_doc_ids = row.get("expected_doc_ids")
        if not isinstance(question_id, str) or not question_id:
            raise ValueError(f"{mode} selection contains an invalid question_id")
        if question_id in seen_questions:
            raise ValueError(f"duplicate question_id in {mode} selection: {question_id}")
        if not isinstance(expected_doc_ids, list) or not all(
            isinstance(document_id, str) and document_id
            for document_id in expected_doc_ids
        ):
            raise ValueError(f"{question_id} contains invalid expected_doc_ids")
        seen_questions.add(question_id)
        question_ids.append(question_id)
        for document_id in expected_doc_ids:
            if document_id not in seen_documents:
                seen_documents.add(document_id)
                document_ids.append(document_id)
    return EvidenceSelection(
        mode=mode,
        question_ids=tuple(question_ids),
        document_ids=tuple(document_ids),
        selection_rule=rule,
    )


def load_conflict_selection(path: Path | str) -> EvidenceSelection:
    return _selection_from_rows(
        _read_jsonl(Path(path)),
        mode="conflicts",
        rule="question_type == conflicting_info",
        include=lambda row: row.get("question_type") == "conflicting_info",
    )


def load_alignment_selection(path: Path | str) -> EvidenceSelection:
    def includes_alignment_term(row: dict[str, Any]) -> bool:
        question = row.get("question")
        if not isinstance(question, str):
            return False
        lowered = question.casefold()
        return any(re.search(rf"\b{re.escape(term)}\b", lowered) for term in ALIGNMENT_TERMS)

    return _selection_from_rows(
        _read_jsonl(Path(path)),
        mode="alignment-discovery",
        rule="question contains whole-word owner|assignee|reporter|reviewer|responsible (v1)",
        include=includes_alignment_term,
    )


def load_identity_selection(path: Path | str) -> EvidenceSelection:
    def metadata_answer_names_person(row: dict[str, Any]) -> bool:
        if row.get("question_type") != "metadata":
            return False
        facts = row.get("answer_facts")
        return isinstance(facts, list) and any(
            isinstance(fact, str) and PERSON_NAME.search(fact) for fact in facts
        )

    return _selection_from_rows(
        _read_jsonl(Path(path)),
        mode="identity-discovery",
        rule="metadata answer_facts contain a two-or-three-token capitalized name (v1); facts discarded",
        include=metadata_answer_names_person,
    )


def load_selection(mode: str, questions: Path) -> EvidenceSelection:
    if mode == "conflicts":
        return load_conflict_selection(questions)
    if mode == "alignment-discovery":
        return load_alignment_selection(questions)
    if mode == "identity-discovery":
        return load_identity_selection(questions)
    raise ValueError(f"unsupported selection mode: {mode}")


def _canonical_document(row: dict[str, Any]) -> dict[str, str]:
    document: dict[str, str] = {}
    for field in ("doc_id", "source_type", "title", "content"):
        value = row.get(field)
        if not isinstance(value, str):
            raise ValueError(f"document {row.get('doc_id', '<unknown>')} has invalid {field}")
        document[field] = value
    return document


def _encoded_row(row: dict[str, str]) -> bytes:
    return (json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def acquire_documents(
    selection: EvidenceSelection,
    rows: Iterable[dict[str, Any]],
    output: Path,
    manifest_path: Path,
) -> dict[str, Any]:
    wanted = set(selection.document_ids)
    documents: dict[str, list[dict[str, str]]] = {}
    duplicate_row_counts: dict[str, int] = {}
    for row in rows:
        document_id = row.get("doc_id")
        if document_id not in wanted:
            continue
        canonical = _canonical_document(row)
        versions = documents.get(document_id, [])
        if canonical in versions:
            duplicate_row_counts[document_id] = (
                duplicate_row_counts.get(document_id, 0) + 1
            )
            continue
        versions.append(canonical)
        documents[document_id] = versions

    resolved_ids = [doc_id for doc_id in selection.document_ids if doc_id in documents]
    missing_ids = [doc_id for doc_id in selection.document_ids if doc_id not in documents]
    ordered_documents = [
        document
        for doc_id in resolved_ids
        for document in sorted(documents[doc_id], key=_encoded_row)
    ]
    encoded_rows = [_encoded_row(document) for document in ordered_documents]
    output_bytes = b"".join(encoded_rows)
    source_counts: dict[str, int] = {}
    document_version_digests: dict[str, list[str]] = {}
    for document in ordered_documents:
        doc_id = document["doc_id"]
        source = document["source_type"]
        source_counts[source] = source_counts.get(source, 0) + 1
        document_version_digests.setdefault(doc_id, []).append(
            hashlib.sha256(_encoded_row(document)).hexdigest()
        )
    divergent_version_counts = {
        doc_id: len(versions)
        for doc_id, versions in documents.items()
        if len(versions) > 1
    }

    manifest = {
        "schemaVersion": 1,
        "acquiredAt": datetime.now(timezone.utc).isoformat(),
        "datasetUrl": DATASET_URL,
        "datasetId": DATASET_ID,
        "config": DATASET_CONFIG,
        "split": DATASET_SPLIT,
        "selectionMode": selection.mode,
        "selectionRule": selection.selection_rule,
        "selectionQuestionIds": list(selection.question_ids),
        "selectedDocumentIds": list(selection.document_ids),
        "resolvedDocumentIds": resolved_ids,
        "missingDocumentIds": missing_ids,
        "duplicateRowCounts": dict(sorted(duplicate_row_counts.items())),
        "divergentVersionCounts": dict(sorted(divergent_version_counts.items())),
        "resolvedRecordCount": len(ordered_documents),
        "sourceCounts": dict(sorted(source_counts.items())),
        "documentVersionSha256": document_version_digests,
        "outputSha256": hashlib.sha256(output_bytes).hexdigest(),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(output_bytes)
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def _dataset_rows() -> Iterable[dict[str, Any]]:
    try:
        from datasets import load_dataset
    except ImportError as error:
        raise RuntimeError(
            "datasets is required; install requirements-data.txt first"
        ) from error
    return load_dataset(
        DATASET_ID,
        DATASET_CONFIG,
        split=DATASET_SPLIT,
        streaming=True,
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--selection",
        required=True,
        choices=("conflicts", "alignment-discovery", "identity-discovery"),
    )
    parser.add_argument("--questions", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    selection = load_selection(args.selection, args.questions)
    manifest = acquire_documents(
        selection,
        _dataset_rows(),
        args.output,
        args.manifest,
    )
    print(json.dumps({
        "selection": selection.mode,
        "questions": len(selection.question_ids),
        "selected": len(selection.document_ids),
        "resolved": len(manifest["resolvedDocumentIds"]),
        "missing": len(manifest["missingDocumentIds"]),
        "output": str(args.output),
        "manifest": str(args.manifest),
    }))
    return 1 if manifest["missingDocumentIds"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
