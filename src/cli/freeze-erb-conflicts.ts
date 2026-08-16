import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  isAcceptedConflictExtraction,
  promoteAcceptedConflict,
} from "@/conflicts/promote-erb-conflict";
import {
  freezeConflictRuntime,
  type ConflictExtractionArtifact,
  type RuntimeConflictManifest,
} from "@/evaluation/erb-conflict-runtime";

export interface FreezeErbConflictArgs {
  manifest: string;
  extractions: string;
  output: string;
}

const usage =
  "Usage: npm run freeze:erb-conflicts -- --manifest <runtime-manifest.json> --extractions <artifact.json> --output <frozen-runtime.json>";

export function parseFreezeErbConflictArgs(args: string[]): FreezeErbConflictArgs {
  const allowed = new Set(["--manifest", "--extractions", "--output"]);
  const values = new Map<string, string>();
  if (args.length !== 6) throw new TypeError(usage);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !allowed.has(flag) || !value || values.has(flag)) {
      throw new TypeError(usage);
    }
    values.set(flag, value);
  }
  const manifest = values.get("--manifest");
  const extractions = values.get("--extractions");
  const output = values.get("--output");
  if (!manifest || !extractions || !output) throw new TypeError(usage);
  return { manifest, extractions, output };
}

async function main(): Promise<void> {
  const options = parseFreezeErbConflictArgs(process.argv.slice(2));
  const [manifestBody, extractionBody] = await Promise.all([
    readFile(path.resolve(options.manifest), "utf8"),
    readFile(path.resolve(options.extractions), "utf8"),
  ]);
  const manifest = JSON.parse(manifestBody) as RuntimeConflictManifest;
  const extraction = JSON.parse(extractionBody) as ConflictExtractionArtifact;
  const promotionCases = extraction.cases as unknown as Array<{
    questionId: string;
    question: string;
    extractions: unknown[];
  }>;
  const promotions = promotionCases.map((item) => {
    const promoted = promoteAcceptedConflict({
      questionId: item.questionId,
      question: item.question,
      accepted: item.extractions.filter(isAcceptedConflictExtraction),
    });
    if (promoted.status === "skipped") return promoted;
    return promoted.status === "resolved"
      ? {
          questionId: promoted.questionId,
          status: "resolved" as const,
          winningValue: promoted.winningValue!,
        }
      : {
          questionId: promoted.questionId,
          status: "unresolved" as const,
          winningValue: null,
        };
  });
  const frozen = freezeConflictRuntime({ manifest, extraction, promotions });
  const output = path.resolve(options.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      output,
      digest: frozen.digest,
      manifestDigest: frozen.manifestDigest,
      ...frozen.summary,
    }),
  );
}

const entrypoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
