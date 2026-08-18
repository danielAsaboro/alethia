"use client";

import { useState } from "react";
import { listJudgeCases, type JudgeCase } from "@/cases/case-registry";
import { CasePicker } from "./components/case-picker";
import { EvidenceWorkspace, type WorkspaceResult } from "./components/evidence-workspace";
import { AppHeader } from "./components/app-header";
import { OverviewPanel } from "./components/overview-panel";

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
      <AppHeader />
      <OverviewPanel />
      <section className="court-layout" id="workspace">
        <CasePicker cases={cases} selectedId={selected.id} onRun={runCase} loading={status === "loading"} />
        <EvidenceWorkspace selected={selected} workspace={workspace} status={status} error={error} />
      </section>
      <section className="graph-contract" id="lineage-principles">
        <div><p className="eyebrow">Ontology contract</p><h2>Trust is structural, not decorative.</h2></div>
        <div className="contract-grid">
          <article><strong>Claims, not chunks</strong><p>Every value keeps exact source, observation, lifecycle, and competing claims.</p></article>
          <article><strong>Decisions are data</strong><p>Rejected mappings and blocked identity merges remain traversable—not buried in prompts.</p></article>
          <article><strong>Abstention is earned</strong><p>NOT_FOUND requires complete coverage. Otherwise the only honest verdict is UNKNOWN.</p></article>
        </div>
      </section>
    </main>
  );
}
