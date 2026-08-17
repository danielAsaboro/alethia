export type RepositoryBoundaryFindingKind =
  | "private_directory"
  | "environment_file"
  | "corpus_payload"
  | "model_payload"
  | "generated_payload"
  | "absolute_workstation_path"
  | "private_key"
  | "aws_access_key"
  | "openai_secret"
  | "github_token";

export interface TrackedFile {
  path: string;
  content: string;
}

export interface RepositoryBoundaryFinding {
  kind: RepositoryBoundaryFindingKind;
  file: string;
  line?: number;
}

const contentScanExclusions = new Set(["src/security/repository-boundary.test.ts"]);

const forbiddenPaths: Array<{ kind: RepositoryBoundaryFindingKind; pattern: RegExp }> = [
  { kind: "private_directory", pattern: /^(?:resources|submission|superpowers|\.superpowers|docs\/(?:plans|specs|brainstorming|verification|superpowers))(?:\/|$)/u },
  { kind: "environment_file", pattern: /(?:^|\/)\.env(?:\..+)?$/u },
  { kind: "corpus_payload", pattern: /(?:^|\/)(?:data|datasets?|corpora)(?:\/|$)|\.(?:jsonl|parquet|arrow|sqlite3?|duckdb)$/iu },
  { kind: "model_payload", pattern: /\.(?:gguf|ggml|safetensors|onnx|pt|pth|ckpt)$/iu },
  { kind: "generated_payload", pattern: /^(?:node_modules|\.next|dist|coverage)(?:\/|$)|(?:^|\/)__pycache__(?:\/|$)|\.(?:pyc|pyo)$/iu },
];

const secretPatterns: Array<{ kind: RepositoryBoundaryFindingKind; pattern: RegExp }> = [
  { kind: "absolute_workstation_path", pattern: /(?:\/Users\/[^/\s"']+|\/home\/[^/\s"']+|[A-Za-z]:\\Users\\[^\\\s"']+)/u },
  { kind: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { kind: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { kind: "openai_secret", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/u },
  { kind: "github_token", pattern: /\bgh[opurs]_[A-Za-z0-9]{30,}\b/u },
];

export function auditTrackedRepository(files: TrackedFile[]) {
  const findings: RepositoryBoundaryFinding[] = [];
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const normalized = file.path.replaceAll("\\", "/");
    for (const rule of forbiddenPaths) {
      if (rule.kind === "environment_file" && normalized === ".env.example") continue;
      if (rule.pattern.test(normalized)) findings.push({ kind: rule.kind, file: normalized });
    }
    if (contentScanExclusions.has(normalized)) continue;
    for (const [index, line] of file.content.split(/\r?\n/u).entries()) {
      for (const rule of secretPatterns) {
        if (rule.pattern.test(line)) findings.push({ kind: rule.kind, file: normalized, line: index + 1 });
      }
    }
  }
  return {
    schemaVersion: 1,
    trackedFiles: files.length,
    contentScanExclusions: [...contentScanExclusions],
    findings,
    passed: findings.length === 0,
  };
}
