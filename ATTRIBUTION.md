# Attribution

## Datasets

- [Enterprise RAG Bench](https://github.com/onyx-dot-app/EnterpriseRAG-Bench), MIT License. Canonical records are acquired from its [Hugging Face dataset](https://huggingface.co/datasets/onyx-dot-app/EnterpriseRAG-Bench) and are not redistributed here.
- [Salesforce HERB](https://huggingface.co/datasets/Salesforce/HERB), CC BY-NC 4.0. The dataset card describes research-use limitations. The corpus is not redistributed here.

## Core infrastructure

- [HydraDB](https://github.com/hydra-db/hydradb), used as the ontology store and graph traversal engine. The container image is pinned by digest in `docker-compose.yml`.
- [QVAC](https://github.com/tetherto/qvac), used locally through `@qvac/cli` and the official `@qvac/ai-sdk-provider` package.
- [Vercel AI SDK](https://sdk.vercel.ai/), used as the model-provider interface.
- [Next.js](https://nextjs.org/) and [React](https://react.dev/), used for the judge-facing web application.
- [Zod](https://zod.dev/), used for strict runtime validation.
- [Vitest](https://vitest.dev/), used for unit and integration tests.

All packages retain their respective licenses and terms. Exact versions are recorded in `package-lock.json`.
