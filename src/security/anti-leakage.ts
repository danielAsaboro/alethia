import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type LeakageKind =
  | "evaluation_field"
  | "benchmark_case_id"
  | "label_import"
  | "verdict_revealing_prompt";

export interface LeakageFinding {
  file: string;
  line: number;
  kind: LeakageKind;
  excerpt: string;
}

const runtimeDirectories = [
  "alignment", "app", "application", "cases", "claims", "conflicts",
  "counterfactuals", "coverage", "domain", "hydra", "ingestion", "noise",
  "qvac", "resolution", "verdicts",
];
const runtimeArtifacts = ["evaluation/judge-cases.runtime.json"];

const evaluationOnlyFiles = new Set(["src/qvac/evaluation-judge.ts"]);
const defensiveGuardFiles = new Set(["src/ingestion/runtime-case.ts"]);

const patterns: Array<{ kind: LeakageKind; pattern: RegExp }> = [
  { kind: "evaluation_field", pattern: /\b(?:expected_doc_ids|gold_answer|answer_facts|evaluation_labels)\b/i },
  { kind: "benchmark_case_id", pattern: /\bqst_\d{4,}\b/i },
  { kind: "label_import", pattern: /(?:from\s+|import\s*\()["'][^"']*(?:labels?|gold|erb-conflict-score|evaluation-judge)[^"']*["']/i },
  { kind: "verdict_revealing_prompt", pattern: /(?:prompt|instruction)[^\n]*(?:correct answer|expected verdict|gold answer|selected answer value)/i },
];

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && /\.(?:ts|tsx|json)$/.test(target) && !target.endsWith(".test.ts") && !target.endsWith(".test.tsx") ? [target] : [];
  }));
  return files.flat();
}

export function scanRuntimeSource(relativeFile: string, source: string): LeakageFinding[] {
  if (evaluationOnlyFiles.has(relativeFile)) return [];
  const findings: LeakageFinding[] = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    for (const { kind, pattern } of patterns) {
      if (kind === "evaluation_field" && defensiveGuardFiles.has(relativeFile)) continue;
      if (pattern.test(line)) findings.push({
        file: relativeFile,
        line: index + 1,
        kind,
        excerpt: line.trim().slice(0, 240),
      });
    }
  }
  return findings;
}

export async function auditRuntimeLeakage(repositoryRoot: string) {
  const srcRoot = path.join(repositoryRoot, "src");
  const files = (await Promise.all(runtimeDirectories.map((directory) => sourceFiles(path.join(srcRoot, directory)))))
    .flat()
    .concat(runtimeArtifacts.map((file) => path.join(repositoryRoot, file)))
    .sort();
  const findings = (await Promise.all(files.map(async (file) => {
    const relative = path.relative(repositoryRoot, file).split(path.sep).join("/");
    return scanRuntimeSource(relative, await readFile(file, "utf8"));
  }))).flat();
  return {
    schemaVersion: 1,
    scannedFiles: files.length,
    runtimeDirectories,
    runtimeArtifacts,
    evaluationOnlyExclusions: [...evaluationOnlyFiles].sort(),
    defensiveGuardExclusions: [...defensiveGuardFiles].sort(),
    findings,
    passed: findings.length === 0,
  };
}
