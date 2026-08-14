"use client";

import { useState } from "react";
import { listJudgeCases, type JudgeCase } from "@/cases/case-registry";
import { CasePicker } from "./components/case-picker";
import { EvidenceWorkspace, type WorkspaceResult } from "./components/evidence-workspace";

export default function Home() {
  const cases = listJudgeCases();
  const [selected, setSelected] = useState<JudgeCase>(cases[0]);
  const [workspace, setWorkspace] = useState<WorkspaceResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function runCase(caseValue: JudgeCase) {
    setSelected(caseValue); setWorkspace(null); setError(""); setStatus("loading");
    try {
      const response = await fetch(`/api/cases/${caseValue.id}/run`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? body.error ?? "Case unavailable");
      setWorkspace(body as WorkspaceResult); setStatus("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught)); setStatus("error");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top"><span className="brand-mark">ST</span><span>SourceTruce</span></a>
        <div className="system-state"><span className="pulse" />HydraDB + local QVAC</div>
      </header>
      <section className="hero court-hero" id="top">
        <div>
          <p className="eyebrow">Enterprise evidence court</p>
          <h1>Every answer should survive cross-examination.</h1>
          <p className="lede">SourceTruce turns noisy enterprise records into inspectable claims, identity decisions, ontology mappings, conflicts, and knowledge boundaries. Pick a real case. The verdict must come back through HydraDB.</p>
        </div>
        <div className="proof-card">
          <p className="proof-label">Verified real-data system</p>
          <div className="proof-grid">
            <div><strong>9</strong><span>enterprise sources</span></div>
            <div><strong>1,627</strong><span>known hard negatives blocked</span></div>
            <div><strong>5</strong><span>contextual mappings</span></div>
            <div><strong>0</strong><span>cloud LLM calls</span></div>
          </div>
          <p className="proof-foot">ERB + HERB · HydraDB OSS · QVAC local</p>
        </div>
      </section>
      <section className="court-layout">
        <CasePicker cases={cases} selectedId={selected.id} onRun={runCase} loading={status === "loading"} />
        <EvidenceWorkspace selected={selected} workspace={workspace} status={status} error={error} />
      </section>
      <section className="graph-contract">
        <p className="eyebrow">Why this is not RAG with a graph sticker</p>
        <div className="contract-grid">
          <article><strong>Claims, not chunks</strong><p>Every value keeps exact source, observation, lifecycle, and competing claims.</p></article>
          <article><strong>Decisions are data</strong><p>Rejected mappings and blocked identity merges remain traversable—not buried in prompts.</p></article>
          <article><strong>Abstention is earned</strong><p>NOT_FOUND requires complete coverage. Otherwise the only honest verdict is UNKNOWN.</p></article>
        </div>
      </section>
    </main>
  );
}
