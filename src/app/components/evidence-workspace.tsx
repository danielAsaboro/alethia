import type { JudgeCase } from "@/cases/case-registry";

export interface WorkspaceResult {
  verdict: "SUPPORTED" | "DISPUTED" | "NOT_FOUND" | "UNKNOWN"; answer: string;
  evidence: Array<{ source: string; quote: string; value?: string }>;
  decision: { status: string; reason: string; policy?: string };
  coverage: { sufficient: boolean; detail: string }; counterfactual: string; traversal: string;
  ablation: { label: string; result: string };
}

export function EvidenceWorkspace({ selected, workspace, status, error }: { selected: JudgeCase; workspace: WorkspaceResult | null; status: "idle" | "loading" | "error"; error: string }) {
  return (
    <section className="evidence-court" aria-live="polite">
      <div className="section-heading"><span>02</span><div><p className="eyebrow">Live Hydra workspace</p><h2>Verdict, evidence, and what would change it</h2></div></div>
      {status === "loading" && <div className="court-empty"><div className="loader" /><h3>Traversing the evidence graph…</h3><p>No cached verdict will be substituted.</p></div>}
      {status === "error" && <div className="error-state"><p className="eyebrow">Case unavailable</p><h3>No verdict issued</h3><p>{error}</p></div>}
      {status === "idle" && !workspace && <div className="court-empty"><span className="empty-glyph">↗</span><h3>{selected.question}</h3><p>Select the highlighted case to run it against live HydraDB.</p></div>}
      {workspace && (
        <div className="workspace-result">
          <div className="result-head"><span className={`verdict-badge ${workspace.verdict.toLowerCase()}`}>{workspace.verdict}</span><p>{selected.question}</p></div>
          <div className="answer-block"><p className="eyebrow">Controlling answer</p><h3>{workspace.answer}</h3></div>
          <div className="workspace-columns">
            <div><p className="eyebrow">Evidence on the record</p>{workspace.evidence.length ? workspace.evidence.map((item, index) => <article className="quote-card" key={`${item.source}-${index}`}><div><span>0{index + 1}</span><strong>{item.source}</strong>{item.value && <em>{item.value}</em>}</div><p>“{item.quote}”</p></article>) : <p className="no-evidence">No claim evidence exists in the covered slice.</p>}</div>
            <div className="decision-stack">
              <article><p className="eyebrow">Decision</p><strong>{workspace.decision.status}</strong><p>{workspace.decision.reason}</p>{workspace.decision.policy && <code>{workspace.decision.policy}</code>}</article>
              <article className={workspace.coverage.sufficient ? "coverage-ok" : "coverage-warn"}><p className="eyebrow">Coverage gate</p><strong>{workspace.coverage.sufficient ? "Sufficient" : "Incomplete"}</strong><p>{workspace.coverage.detail}</p></article>
            </div>
          </div>
          <div className="proof-row"><article><p className="eyebrow">What would change this?</p><p>{workspace.counterfactual}</p></article><article><p className="eyebrow">Ablation · {workspace.ablation.label}</p><p>{workspace.ablation.result}</p></article></div>
          <code className="path-code">{workspace.traversal}</code>
        </div>
      )}
    </section>
  );
}
