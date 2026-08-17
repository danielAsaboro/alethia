import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { auditTrackedRepository } from "@/security/repository-boundary";

const execFile = promisify(execFileCallback);
const usage = "Usage: npm run audit:repository -- [--root <repository>] [--output <report.json>]";

interface Args { root: string; output?: string }

export function parseAuditRepositoryArgs(args: string[]): Args {
  const values: Args = { root: "." };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!value || (flag !== "--root" && flag !== "--output")) throw new TypeError(usage);
    if (flag === "--root") values.root = value;
    else values.output = value;
  }
  return values;
}

async function main() {
  const args = parseAuditRepositoryArgs(process.argv.slice(2));
  const root = path.resolve(args.root);
  const { stdout } = await execFile("git", ["ls-files", "-z"], { cwd: root, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  const trackedPaths = stdout.toString("utf8").split("\0").filter(Boolean);
  const files = await Promise.all(trackedPaths.map(async (file) => ({ file, bytes: await readFile(path.join(root, file)) })));
  const report = auditTrackedRepository(files.map(({ file, bytes }) => ({ path: file, content: bytes.toString("utf8") })));
  const artifact = {
    ...report,
    generatedAt: new Date().toISOString(),
    trackedTreeSha256: createHash("sha256")
      .update(files.map(({ file, bytes }) => `${file}\0${createHash("sha256").update(bytes).digest("hex")}\n`).join(""))
      .digest("hex"),
  };
  if (args.output) {
    const output = path.resolve(args.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ trackedFiles: report.trackedFiles, findings: report.findings.length, passed: report.passed, output: args.output ? path.resolve(args.output) : null }));
  if (!report.passed) process.exitCode = 1;
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
