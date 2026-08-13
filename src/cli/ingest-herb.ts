import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { HerbAdapter } from "@/ingestion/herb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";

interface IngestHerbArgs {
  input: string;
  output: string;
}

const usage =
  "Usage: npm run ingest:herb -- --input <path> --output <path>";

export function parseIngestHerbArgs(args: string[]): IngestHerbArgs {
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
  const options = parseIngestHerbArgs(process.argv.slice(2));
  const bundle = await runIngestion(new HerbAdapter(), options.input);
  const outputPath = path.resolve(options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify({
      outputPath,
      ...bundle.summary,
      coverageComplete: bundle.coverage.every(
        (slice) => slice.status === "complete",
      ),
    }),
  );

  if (bundle.coverage.some((slice) => slice.status === "failed")) {
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
