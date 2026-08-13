<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Hack Hydra public repository rules

- This is the only public/submittable repository. Keep private research, downloaded corpora, submission evidence, and internal plans in the parent workspace.
- Build Track 01 SourceTruce as a real ingestion-to-answer product. HydraDB must store/query the ontology and perform meaningful graph-native work.
- Use real Enterprise RAG Bench and/or HERB data for claimed ingestion, evaluation, and demo behavior. Do not ship mocks, fake integrations, placeholder success paths, or invented benchmark results.
- Preserve aliases, claims, provenance, time, contradictions, supersession, and abstention as inspectable behavior.
- Keep the README, setup/run instructions, HydraDB explanation, environment/dependency details, third-party attribution, and open-source license complete.
- Never commit secrets or downloaded benchmark corpora. Respect the Enterprise RAG Bench license and HERB's CC BY-NC 4.0/research-use limitations.
- Before claiming HydraDB works, save evidence of a real write/read round trip under the parent `../submission/evidence/` directory.
- Before claiming completion, run lint, tests, production build, benchmark/evaluation commands, and the working demo path. Save outputs outside this repo under `../submission/evidence/`.

<!-- hackathon-project-setup:superpowers-boundary:start -->
## Internal Superpowers artifacts are forbidden

This directory is the public/submittable Git repository. Never create, copy, stage, or commit internal Superpowers-generated specs, implementation plans, brainstorming notes, verification plans/reports, or other agent-internal planning documents anywhere in this repository.

Write those artifacts only in the private parent workspace at `../superpowers/`. If any internal artifact appears here, move it to `../superpowers/recovered/<project-dir>/` while preserving its contents and relative path; do not delete it. Paths including `.superpowers/`, `superpowers/`, `docs/superpowers/`, `docs/plans/`, `docs/specs/`, `docs/brainstorming/`, and `docs/verification/` are forbidden here.

The public `docs/` directory is reserved exclusively for user-facing project documentation intended for publication or hosting (for example, Mintlify). `.gitignore` entries are defense in depth, not permission to place internal artifacts in this repo. Never force-add an ignored internal artifact.
<!-- hackathon-project-setup:superpowers-boundary:end -->
