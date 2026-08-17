import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditRuntimeLeakage } from "@/security/anti-leakage";

interface Args { root: string; output?: string }
const usage = "Usage: npm run audit:anti-leakage -- [--root <repository>] [--output <report.json>]";

export function parseAuditAntiLeakageArgs(args: string[]): Args {
  const values: Args = { root: "." };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || (flag !== "--root" && flag !== "--output")) throw new TypeError(usage);
    if (flag === "--root") values.root = value;
    if (flag === "--output") values.output = value;
  }
  return values;
}

async function main(): Promise<void> {
  const options = parseAuditAntiLeakageArgs(process.argv.slice(2));
  const root = path.resolve(options.root);
  const report = await auditRuntimeLeakage(root);
  const artifact = {
    ...report,
    generatedAt: new Date().toISOString(),
    repositoryTreeDigest: createHash("sha256").update(JSON.stringify(report)).digest("hex"),
  };
  if (options.output) {
    const output = path.resolve(options.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ scannedFiles: report.scannedFiles, findings: report.findings.length, passed: report.passed, output: options.output ? path.resolve(options.output) : null }));
  if (!report.passed) process.exitCode = 1;
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
