# Ontology contract

SourceTruce models evidence and uncertainty as graph structure. Every identifier is a deterministic SHA-256-derived logical ID, while HydraDB receives a stable integer projection for its node and relationship IDs.

## Nodes

| Label | Purpose | Important properties |
| --- | --- | --- |
| `Entity` | Canonical person, product, or organization | kind, identity keys, source-object count |
| `SourceObject` | Immutable normalized enterprise record | source system, native ID, type, payload digest |
| `Claim` | One subject-predicate-object assertion | predicate, typed object, extraction method/version |
| `ResolutionDecision` | Inspectable merge or rejection certificate | status, signals, constraints, confidence, algorithm version |
| `CoverageSlice` | Proof of what an ingestion run examined | source, object type, predicate families, content scope, status |
| `IngestionRun` | Adapter execution identity | adapter version, source system |

## Evidence path

```cypher
MATCH (e:Entity)-[:ASSERTS]->(c:Claim)-[:SUPPORTED_BY]->(s:SourceObject)
RETURN e.logical_id, c.logical_id, s.logical_id
```

This is the minimum chain of custody for a supported answer. The application reads the claim and source payloads from this path and does not reconstruct a successful answer from an in-memory corpus.

## Identity path

```cypher
MATCH (d:ResolutionDecision)-[:CONSIDERS]->(s:SourceObject)-[:RESOLVES_TO]->(e:Entity)
RETURN d, s, e
```

Exact external IDs and exact cross-source emails may produce accepted merges. Name-only matches are emitted as rejected candidates because a shared display name is not sufficient proof. Decisions are immutable and can be superseded by explicit reversals.

## Coverage path

```cypher
MATCH (r:IngestionRun)-[:COVERS]->(c:CoverageSlice)
RETURN r, c
```

A negative answer is only `NOT_FOUND` when a complete slice covers the requested source system, object type, predicate family, and content scope. Missing, partial, failed, or semantically narrower coverage yields `UNKNOWN` with a machine-readable reason.

## Domain relationships

Entity-valued claims also materialize graph-native traversal edges:

- `MEMBER_OF`
- `MANAGES`
- `HAS_TEAM_MEMBER`
- `SERVES_CUSTOMER`

Each edge retains the originating claim ID, so multi-hop navigation remains connected to the same claim-level provenance model.
