#!/usr/bin/env python3
"""Build and verify a full Enterprise RAG Bench lexical index."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--ontology-ledger", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--reuse-existing", action="store_true")
    return parser.parse_args(argv)


def build_index(connection: Any, parquet: Path) -> None:
    connection.execute("INSTALL fts")
    connection.execute("LOAD fts")
    connection.execute("DROP TABLE IF EXISTS documents")
    connection.execute(
        "CREATE TABLE documents AS SELECT row_number() OVER () AS row_id, "
        f"doc_id, source_type, title, content FROM read_parquet('{parquet.as_posix()}')"
    )
    connection.execute(
        "PRAGMA create_fts_index('documents', 'row_id', 'title', 'content', "
        "stemmer='porter', stopwords='english', lower=1, strip_accents=1)"
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        import duckdb
    except ImportError as error:
        raise RuntimeError("duckdb is required; install requirements-data.txt") from error
    started = time.monotonic()
    if not args.input.is_file() or not args.ontology_ledger.is_file():
        raise FileNotFoundError("Input Parquet and ontology ledger are required")
    args.database.parent.mkdir(parents=True, exist_ok=True)
    extension_directory = os.environ.get("ALETHIA_DUCKDB_EXTENSION_DIRECTORY")
    config = {"extension_directory": extension_directory} if extension_directory else {}
    connection = duckdb.connect(str(args.database), config=config)
    connection.execute("INSTALL fts")
    if not args.reuse_existing:
        build_index(connection, args.input.resolve())
    connection.execute("LOAD fts")
    columns = connection.execute("DESCRIBE documents").fetchall()
    if [row[0] for row in columns] != ["row_id", "doc_id", "source_type", "title", "content"]:
        raise RuntimeError("Lexical index table has an unexpected schema")
    counts = connection.execute(
        "SELECT count(*), count(DISTINCT doc_id), "
        "count(DISTINCT (doc_id, source_type)), "
        "count(DISTINCT hash(doc_id, source_type, title, content)), "
        "sum(CASE WHEN title IS NULL OR content IS NULL THEN 1 ELSE 0 END) FROM documents"
    ).fetchone()
    sources = dict(connection.execute(
        "SELECT source_type, count(*) FROM documents GROUP BY 1 ORDER BY 1"
    ).fetchall())
    duplicate_ids = connection.execute(
        "SELECT doc_id, count(*) AS rows, count(DISTINCT hash(source_type, title, content)) AS versions "
        "FROM documents GROUP BY 1 HAVING count(*) > 1 ORDER BY 1"
    ).fetchall()
    smoke_rows = connection.execute(
        "SELECT doc_id, source_type, title, fts_main_documents.match_bm25(row_id, 'regional failover') AS score "
        "FROM documents WHERE score IS NOT NULL ORDER BY score DESC LIMIT 5"
    ).fetchall()
    connection.close()
    ontology_bytes = args.ontology_ledger.read_bytes()
    ontology = json.loads(ontology_bytes)
    ledger = ontology.get("ledger", {})
    artifact = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": {
            "name": "Enterprise RAG Bench",
            "revision": "5665533",
            "inputBytes": args.input.stat().st_size,
            "inputSha256": file_sha256(args.input),
            "canonicalSchema": ["doc_id", "source_type", "title", "content"],
        },
        "lexicalIndex": {
            "documentsIndexed": counts[0],
            "distinctDocumentIds": counts[1],
            "distinctSourceDocumentIds": counts[2],
            "distinctRows": counts[3],
            "nullTitleOrContentRows": counts[4],
            "sourceCounts": sources,
            "duplicateNativeIds": [
                {"docId": row[0], "rows": row[1], "distinctVersions": row[2]}
                for row in duplicate_ids
            ],
            "engine": "DuckDB FTS",
            "configuration": {
                "fields": ["title", "content"],
                "stemmer": "porter",
                "stopwords": "english",
                "lower": True,
                "stripAccents": True,
            },
            "databaseBytes": args.database.stat().st_size,
            "databaseSha256": file_sha256(args.database),
            "smokeQuery": {
                "query": "regional failover",
                "rows": [
                    {"docId": row[0], "sourceSystem": row[1], "title": row[2], "score": row[3]}
                    for row in smoke_rows
                ],
            },
        },
        "deepOntologyLane": {
            "ledgerSha256": hashlib.sha256(ontology_bytes).hexdigest(),
            "recordsAttempted": ledger.get("recordsAttempted"),
            "recordsAccepted": ledger.get("counts", {}).get("accepted"),
            "sourceObjects": ledger.get("scope", {}).get("distinctNativeObjects"),
            "graphNodes": ledger.get("scope", {}).get("graphNodes"),
            "graphEdges": ledger.get("scope", {}).get("graphEdges"),
            "extractionGaps": ledger.get("noise", {}).get("extractionGaps"),
        },
        "separation": "Full-corpus lexical indexing and bounded deep ontology extraction are distinct lanes; indexed documents are not claimed as claim-graph records.",
        "elapsedSeconds": time.monotonic() - started,
        "environment": {"python": os.sys.version.split()[0], "duckdb": duckdb.__version__},
    }
    if counts[0] != 511962 or counts[3] != counts[0] or len(sources) != 9 or counts[4] != 0 or len(smoke_rows) != 5:
        raise RuntimeError("Full-corpus index verification failed")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "documentsIndexed": counts[0],
        "sourceSystems": len(sources),
        "databaseBytes": args.database.stat().st_size,
        "smokeRows": len(smoke_rows),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
