import { describe, expect, it } from "vitest";

import { auditTrackedRepository } from "./repository-boundary";

describe("auditTrackedRepository", () => {
  it("accepts the allowed public repository shape", () => {
    expect(auditTrackedRepository([
      { path: ".env.example", content: "TOKEN=replace-me\n" },
      { path: "src/index.ts", content: "export const ready = true;\n" },
      { path: "evaluation/cases.labels.json", content: "{}\n" },
    ])).toMatchObject({ passed: true, findings: [] });
  });

  it.each([
    ["private_directory", "resources/audits/strategy.md", "private"],
    ["private_directory", "docs/plans/internal.md", "private"],
    ["environment_file", ".env.production", "TOKEN=value"],
    ["corpus_payload", "data/corpus.jsonl", "{}"],
    ["model_payload", "models/extractor.gguf", "binary"],
    ["generated_payload", "scripts/__pycache__/module.pyc", "binary"],
  ])("rejects %s paths", (kind, file, content) => {
    expect(auditTrackedRepository([{ path: file, content }]).findings).toMatchObject([{ kind, file }]);
  });

  it.each([
    ["absolute_workstation_path", "const p = '/Users/alice/private/data.json';"],
    ["private_key", "-----BEGIN OPENSSH PRIVATE KEY-----"],
    ["aws_access_key", "AKIAABCDEFGHIJKLMNOP"],
    ["openai_secret", "sk-abcdefghijklmnopqrstuvwxyz123456"],
    ["github_token", "ghp_abcdefghijklmnopqrstuvwxyz1234567890"],
  ])("rejects %s content", (kind, content) => {
    expect(auditTrackedRepository([{ path: "src/unsafe.ts", content }]).findings).toMatchObject([{ kind, file: "src/unsafe.ts" }]);
  });

  it("reports every finding instead of stopping at the first", () => {
    const report = auditTrackedRepository([
      { path: ".env.local", content: "/Users/alice/private\n-----BEGIN PRIVATE KEY-----" },
    ]);
    expect(report.passed).toBe(false);
    expect(report.findings.map((finding) => finding.kind)).toEqual([
      "environment_file",
      "absolute_workstation_path",
      "private_key",
    ]);
  });
});
