import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ErbAdapter } from "@/ingestion/erb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";

interface IngestErbArgs {
  input: string;
  output: string;
}

const usage = "Usage: npm run ingest:erb -- --input <path> --output <path>";

export function parseIngestErbArgs(args: string[]): IngestErbArgs {
  let input: string | undefined;
  let output: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || (flag !== "--input" && flag !== "--output")) {
      throw new TypeError(usage);
    }
    if (flag === "--input") input = value;
    if (flag === "--output") output = value;
  }
  if (!input || !output) throw new TypeError(usage);
  return { input, output };
}

async function main(): Promise<void> {
  const options = parseIngestErbArgs(process.argv.slice(2));
  const bundle = await runIngestion(new ErbAdapter(), options.input);
  const outputPath = path.resolve(options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify({
      outputPath,
      ...bundle.summary,
      sourceSystems: [...
        new Set(bundle.records.map((record) => record.sourceSystem)),
      ].sort(),
      coverageComplete: bundle.coverage.every(
        (slice) => slice.status === "complete",
      ),
    }),
  );
  if (bundle.rejected.length > 0) process.exitCode = 1;
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
