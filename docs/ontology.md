# Ontology reference

Alethia stores evidence, decisions, and uncertainty as graph structure. Logical IDs are deterministic SHA-256 projections; HydraDB receives stable integer IDs derived from those logical IDs.

## Node labels

| Label | Purpose | Selected properties |
| --- | --- | --- |
| `Entity` | Canonical person, product, organization, or queried subject | kind, identity keys, source-object count |
| `SourceObject` | Immutable normalized enterprise record | source system, native ID, type, payload digest |
| `Claim` | Typed subject-predicate-object assertion | predicate, object JSON, extractor and version |
| `ExtractionObservation` | One method's grounded observation of a claim | exact quote, method, extractor version |
| `Conflict` | Pair of incompatible claims and resolution state | resolution, policy ID |
| `AuthorityPolicy` | Versioned deterministic precedence rule | predicate, source scope, priority, rationale |
| `SourceSchemaTerm` | Source-qualified field meaning | source, object type, surface, contextual role |
| `OntologyTerm` | Canonical relation with domain and range | name, domain, range |
| `AlignmentDecision` | Accepted, rejected, or pending mapping | status, reason, rule version, constraints |
| `Identity` | Normalized email, external ID, name, or handle | kind, normalized value, namespace |
| `ResolutionDecision` | Accepted, rejected, pending, or reversed identity decision | status, confidence, algorithm version |
| `ResolutionSignal` | Positive identity evidence | kind, normalized value |
| `ResolutionConstraint` | Hard or cautionary merge constraint | kind |
| `CoverageSlice` | Bounded proof of what ingestion examined | source, object type, predicate families, content scope, status |
| `IngestionRun` | Adapter execution identity | adapter version, source system |
| `CounterfactualRequirement` | Evidence or decision that could change a verdict | kind, summary, references |

## Relationship types

| Relationship | Meaning |
| --- | --- |
| `ASSERTS` | Entity has a claim |
| `HAS_OBSERVATION` | Claim was produced by a grounded observation |
| `SUPPORTED_BY` | Claim or decision signal points to its evidence object |
| `CONTRADICTS` | Claims are mutually incompatible in the same scope |
| `CORROBORATES` | Independent sources support equivalent claims |
| `DECIDED_BY` | Conflict was adjudicated by an authority policy |
| `OBSERVED_AS` | Source object exposes a source-schema term |
| `MAPS_TO` | Accepted source term to ontology term mapping |
| `REJECTED_MAPPING` | Rejected candidate ontology mapping retained for audit |
| `HAS_IDENTITY` | Source object carries a normalized identity key |
| `CONSIDERS` | Decision considered a source object, claim, or ontology candidate |
| `BLOCKED_BY` | Identity decision is prevented by a hard constraint |
| `RESOLVES_TO` | Source object or accepted decision resolves to a canonical entity |
| `COVERS` | Ingestion run completed or attempted a coverage slice |
| `OBSERVED_IN` | Source object arrived in an ingestion run |
| `VERSION_OF` | Divergent payload snapshots share a source-qualified native ID; edge direction is only chronological when evidence supplies chronology |
| `WOULD_CHANGE_IF` / `REQUIRES` | Verdict counterfactual dependency |

Domain relationships such as `MEMBER_OF`, `MANAGES`, `HAS_TEAM_MEMBER`, and `SERVES_CUSTOMER` are materialized from entity-valued claims and retain their originating claim IDs.

## Source-version path

```cypher
MATCH (variant:SourceObject)-[r:VERSION_OF]->(anchor:SourceObject)
RETURN variant, r, anchor
```

The real ERB conflict acquisition contains one Jira native ID with two divergent payloads. Alethia preserves both and writes one `VERSION_OF` edge. Because the acquisition has no reliable version timestamps, the edge uses a deterministic digest anchor and stores `orderKnown=false`; it does not manufacture a “latest” document.

## Conflict evidence path

```cypher
MATCH (e:Entity)-[:ASSERTS]->(c:Claim)
      -[:HAS_OBSERVATION]->(o:ExtractionObservation)
      -[:SUPPORTED_BY]->(s:SourceObject)
RETURN e, c, o, s
```

```cypher
MATCH (f:Conflict)-[:CONSIDERS]->(c:Claim),
      (f)-[:DECIDED_BY]->(p:AuthorityPolicy)
RETURN f, c, p
```

The winner is determined from the conflict side and versioned policy. The losing claim and observation are not deleted.

## Ontology-alignment path

```cypher
MATCH (s:SourceObject)-[:OBSERVED_AS]->(t:SourceSchemaTerm)
OPTIONAL MATCH (t)-[:MAPS_TO]->(o:OntologyTerm)
OPTIONAL MATCH (d:AlignmentDecision)-[:REJECTED_MAPPING]->(rejected:OntologyTerm)
RETURN s, t, o, d, rejected
```

An accepted mapping requires an exact registry rule plus compatible domain and range. Same-surface fields from different source contexts have different source-term identities.

## Identity-decision path

```cypher
MATCH (d:ResolutionDecision)-[:CONSIDERS]->(s:SourceObject)
OPTIONAL MATCH (d)-[:SUPPORTED_BY]->(signal:ResolutionSignal)
OPTIONAL MATCH (d)-[:BLOCKED_BY]->(constraint:ResolutionConstraint)
RETURN d, s, signal, constraint
```

Exact verified email, exact namespaced external ID, or an explicit verified account link may accept a merge. Name similarity and neighborhood overlap alone remain pending. Conflicting verified email or employee ID forces rejection. Cluster-level constraints prevent a transitive merge from bypassing pairwise blockers.

## Coverage path and verdict semantics

```cypher
MATCH (r:IngestionRun)-[:COVERS]->(c:CoverageSlice)
RETURN r, c
```

| Verdict | Required condition |
| --- | --- |
| `SUPPORTED` | At least one controlling claim survives identity, conflict, and policy checks |
| `DISPUTED` | Credible incompatible claims remain unresolved |
| `NOT_FOUND` | Identity is resolved, no claim exists, and every required coverage slice is complete |
| `UNKNOWN` | Identity or required coverage is missing, partial, failed, or semantically narrower |

HydraDB unavailability is not a verdict. The API returns 503 instead of substituting an in-memory result.
