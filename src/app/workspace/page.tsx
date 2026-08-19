"use client";

import { useState } from "react";

import { listJudgeCases, type JudgeCase } from "@/cases/case-registry";
import { AppHeader } from "../components/app-header";
import { CasePicker } from "../components/case-picker";
import { EvidenceWorkspace, type WorkspaceResult } from "../components/evidence-workspace";

export function SourceTruceApp({ cases }: { cases: JudgeCase[] }) {
  const [selected, setSelected] = useState<JudgeCase | null>(cases[0] ?? null);
  const [workspace, setWorkspace] = useState<WorkspaceResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function runCase(caseValue: JudgeCase) {
    setSelected(caseValue);
    setWorkspace(null);
    setError("");
    setStatus("loading");

    try {
      const response = await fetch(`/api/cases/${caseValue.id}/run`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? body.error ?? "Case unavailable");
      setWorkspace(body as WorkspaceResult);
      setStatus("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("error");
    }
  }

  return (
    <main className="shell workspace-shell">
      <AppHeader
        status={status === "loading" ? "loading" : status === "error" ? "error" : workspace ? "verified" : "unverified"}
      />
      <section className="court-layout" id="workspace">
        <CasePicker cases={cases} selectedId={selected?.id ?? ""} onRun={runCase} loading={status === "loading"} />
        {selected ? (
          <EvidenceWorkspace selected={selected} workspace={workspace} status={status} error={error} onRun={() => runCase(selected)} />
        ) : (
          <section className="no-selection">
            <p className="eyebrow">No question selected</p>
            <h2>The runtime manifest contains no judge cases.</h2>
            <p>Configure a real case before opening the evidence workspace.</p>
          </section>
        )}
      </section>
    </main>
  );
}

export default function Workspace() {
  return <SourceTruceApp cases={listJudgeCases()} />;
}
