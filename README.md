# SourceTruce

SourceTruce turns noisy enterprise records into a provenance-aware ontology in HydraDB. It is being built for Hack Hydra Track 01: Enterprise Context and Ontology.

The product is designed to resolve aliases across enterprise applications, align heterogeneous schemas, preserve contradictory time-scoped claims, answer through graph traversal, explain its evidence, and abstain when the corpus does not support an answer.

## Status

This repository currently contains the fresh public application scaffold created during the Hack Hydra build window. Product implementation and verified benchmark results will be added here; private research and submission working files are intentionally kept outside the public repository.

## Development

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Verification commands:

```bash
npm run lint
npm run build
```

## Planned HydraDB role

HydraDB will store canonical entities, aliases, source documents, time-scoped claims, provenance, contradictions, supersession decisions, and enterprise relationships. The shipped system must perform real ingestion and graph queries against HydraDB; a README-only integration does not satisfy this project's acceptance criteria.

## Datasets

- [Enterprise RAG Bench](https://github.com/onyx-dot-app/EnterpriseRAG-Bench), MIT-licensed repository and benchmark materials
- [Salesforce HERB](https://huggingface.co/datasets/Salesforce/HERB), CC BY-NC 4.0 with research-use limitations described on its dataset card

Dataset files are not committed to this repository. Final documentation will include exact download, attribution, and evaluation instructions for every dataset used in reported results.

## License

SourceTruce is licensed under the [MIT License](LICENSE). Third-party dependencies, HydraDB, and datasets retain their own licenses and terms.

