import type { JudgeCase } from "@/cases/case-registry";
import { LineagePath } from "./lineage-path";
import { StatusIcon } from "./status-icon";

export interface WorkspaceResult {
  verdict: "SUPPORTED" | "DISPUTED" | "NOT_FOUND" | "UNKNOWN";
  answer: string;
  evidence: Array<{ source: string; quote: string; value?: string }>;
  decision: { status: string; reason: string; policy?: string };
  coverage: { sufficient: boolean; detail: string };
  counterfactual: string;
  traversal: string;
  ablation: { label: string; result: string };
  graphProof: { operation: "algo.SPpaths" | "algo.SPpaths.sequence"; consistency: "strong"; queryId: string; readEpoch: number | null; bookmark: string | null; latencyMs: number; roundTrips: number; pathLength: number; path: string; relationshipTypes: string[] };
}

type WorkspaceProps = { selected: JudgeCase; workspace: WorkspaceResult | null; status: "idle" | "loading" | "error"; error: string };

export function EvidenceWorkspace({ selected, workspace, status, error }: WorkspaceProps) {
  return (
    <section className="evidence-court" aria-label="Evidence workspace" aria-live="polite">
      <header className="workspace-header">
        <div><p className="eyebrow">Selected question</p><h2>{selected.question}</h2></div>
        <span className="live-query"><i />Live HydraDB query</span>
      </header>
      {status === "loading" && <div className="workspace-state" role="status" aria-label="Running live HydraDB case"><div className="loader" aria-hidden="true" /><p className="eyebrow">Traversing live graph</p><h3>Following claims to their evidence…</h3><p>No cached verdict will be substituted.</p></div>}
      {status === "error" && <div className="workspace-state error-state" role="alert"><span className="state-icon"><StatusIcon name="shield" /></span><p className="eyebrow">Case unavailable</p><h3>No verdict issued</h3><p>{error}</p><p className="error-action">Check HydraDB availability and retry the case. SourceTruce will not substitute a cached answer.</p></div>}
      {status === "idle" && !workspace && <div className="workspace-state"><span className="state-icon"><StatusIcon name="lineage" /></span><p className="eyebrow">Ready to cross-examine</p><h3>Run the selected case against the evidence graph.</h3><p>Choose the highlighted case to retrieve the verdict, evidence, and what would change it.</p></div>}
      {workspace && (
        <div className="workspace-result">
          <section className={`verdict-panel ${workspace.verdict.toLowerCase()}`}>
            <div className="verdict-title"><span className="verdict-badge">{workspace.verdict}</span><span>{workspace.verdict === "DISPUTED" ? "Conflict visibility" : workspace.verdict === "UNKNOWN" ? "Coverage incomplete" : "Evidence decision"}</span></div>
            <p className="eyebrow">Controlling answer</p><h3>{workspace.answer}</h3>
          </section>
          <div className="workspace-grid">
            <section className="evidence-panel">
              <div className="subsection-heading"><div><p className="eyebrow">Evidence provenance</p><h3>Sources on the record</h3></div><span>{workspace.evidence.length}</span></div>
              {workspace.evidence.length ? workspace.evidence.map((item, index) => <article className="quote-card" key={`${item.source}-${index}`}><span className="source-number">{String(index + 1).padStart(2, "0")}</span><div><div className="source-head"><strong>{item.source}</strong>{item.value && <em>{item.value}</em>}</div><blockquote>“{item.quote}”</blockquote></div></article>) : <p className="no-evidence">No claim evidence exists in the covered slice.</p>}
            </section>
            <aside className="decision-stack" aria-label="Decision and coverage">
              <article><span className="card-icon lavender"><StatusIcon name="shield" /></span><p className="eyebrow">Decision</p><strong>{workspace.decision.status}</strong><p>{workspace.decision.reason}</p>{workspace.decision.policy && <code>{workspace.decision.policy}</code>}</article>
              <article className={workspace.coverage.sufficient ? "coverage-ok" : "coverage-warn"}><span className="card-icon mint"><StatusIcon name="database" /></span><p className="eyebrow">Coverage gate</p><strong>{workspace.coverage.sufficient ? "Sufficient" : "Coverage incomplete"}</strong><p>{workspace.coverage.detail}</p></article>
            </aside>
          </div>
          <div className="reasoning-grid"><article><p className="eyebrow">What would change this?</p><p>{workspace.counterfactual}</p></article><article><p className="eyebrow">Ablation · {workspace.ablation.label}</p><p>{workspace.ablation.result}</p></article></div>
          <LineagePath proof={workspace.graphProof} traversal={workspace.traversal} />
        </div>
      )}
    </section>
  );
}
