import Image from "next/image";

import type { JudgeCase } from "@/cases/case-registry";
import { LineagePath } from "./lineage-path";
import { StatusIcon } from "./status-icon";
import { CircleChain, CoverageGlyph } from "./visual-motifs";

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

type WorkspaceProps = {
  selected: JudgeCase;
  workspace: WorkspaceResult | null;
  status: "idle" | "loading" | "error";
  error: string;
  onRun?: () => void;
};

export function EvidenceWorkspace({ selected, workspace, status, error, onRun }: WorkspaceProps) {
  const queryLabel = status === "loading" ? "Query in progress" : status === "error" ? "Query unavailable" : workspace ? "Live proof verified" : "Ready for live query";
  const queryStatus = workspace ? "verified" : status;

  return (
    <section className="evidence-court" aria-label="Evidence workspace" aria-live="polite">
      <header className="question-stage">
        <p className="stage-kicker">Selected question / {selected.kind.replaceAll("_", " ")}</p>
        <h2>{selected.question}</h2>
        <Image className="question-sculpture" src="/visuals/evidence-sculpture.png" width={1024} height={1536} alt="" />
        <CircleChain className="question-chain" count={6} />
        <p className="question-context">{selected.dataset} · {selected.version} · {selected.kind.replaceAll("_", " ")}</p>
        <span className={`live-query ${queryStatus}`}><i />{queryLabel}</span>
        <button className="run-case-button" type="button" onClick={onRun} disabled={!onRun || status === "loading"} aria-busy={status === "loading"}>
          <span>{status === "loading" ? "Running live case" : "Run live case"}</span><i aria-hidden="true">↗</i>
        </button>
      </header>

      {status === "loading" && (
        <div className="workspace-state loading-state" role="status" aria-label="Running live HydraDB case">
          <p className="eyebrow">Evidence path in motion</p>
          <CircleChain className="loading-chain" count={7} label="Traversing the live evidence graph" />
          <h3>Following claims to their evidence…</h3>
          <p>No cached verdict will be substituted.</p>
        </div>
      )}
      {status === "error" && (
        <div className="workspace-state error-state" role="alert">
          <span className="state-icon"><StatusIcon name="shield" /></span>
          <p className="eyebrow">Case unavailable</p><h3>No verdict issued</h3><p>{error}</p>
          <p className="error-action">Check HydraDB availability and retry the case. SourceTruce will not substitute a cached answer.</p>
        </div>
      )}
      {status === "idle" && !workspace && (
        <div className="workspace-state idle-state">
          <CircleChain className="idle-chain" count={6} striped label="Unresolved evidence path" />
          <p className="eyebrow">Ready to cross-examine</p>
          <h3>Run the selected case against the evidence graph.</h3>
          <p>Choose the highlighted case to retrieve the verdict, evidence, and what would change it.</p>
        </div>
      )}

      {workspace && (
        <div className="workspace-result">
          <section className={`verdict-panel ${workspace.verdict.toLowerCase()}`} aria-label="Verdict chapter">
            <div className="verdict-title"><span className="verdict-badge">{workspace.verdict}</span><span>{workspace.verdict === "DISPUTED" ? "Conflict visibility" : workspace.verdict === "UNKNOWN" ? "Coverage incomplete" : "Evidence decision"}</span></div>
            <p className="eyebrow">Controlling answer</p><h3>{workspace.answer}</h3>
            <CircleChain className="verdict-chain" count={5} />
          </section>

          <section className="provenance-chapter" aria-label="Evidence provenance chapter">
            <Image className="provenance-cluster" src="/visuals/source-object-cluster.png" width={1536} height={1024} alt="" />
            <div className="subsection-heading"><div><p className="eyebrow">Evidence provenance</p><h3>Sources on the record</h3></div><span>{workspace.evidence.length}</span></div>
            <div className="evidence-card-stack">
              {workspace.evidence.length ? workspace.evidence.map((item, index) => (
                <article className="quote-card" key={`${item.source}-${index}`}>
                  <span className="source-number">{String(index + 1).padStart(2, "0")}</span>
                  <div><div className="source-head"><strong>{item.source}</strong>{item.value && <em>{item.value}</em>}</div><blockquote>“{item.quote}”</blockquote></div>
                  <b aria-hidden="true">{String(index + 1).padStart(2, "0")}</b>
                </article>
              )) : <p className="no-evidence">No claim evidence exists in the covered slice.</p>}
            </div>
          </section>

          <section className="decision-chapter" aria-label="Decision and coverage chapter">
            <article className="decision-orbit">
              <span className="card-icon terminal"><StatusIcon name="shield" /></span>
              <p className="eyebrow">Decision</p><strong>{workspace.decision.status}</strong><p>{workspace.decision.reason}</p>
              {workspace.decision.policy && <code>{workspace.decision.policy}</code>}
            </article>
            <article className={`coverage-orbit ${workspace.coverage.sufficient ? "coverage-ok" : "coverage-warn"}`}>
              <CoverageGlyph sufficient={workspace.coverage.sufficient} />
              <p className="eyebrow">Coverage gate</p><strong>{workspace.coverage.sufficient ? "Sufficient" : "Coverage incomplete"}</strong><p>{workspace.coverage.detail}</p>
            </article>
            <article className="reason-card counterfactual-card"><p className="eyebrow">What would change this?</p><p>{workspace.counterfactual}</p></article>
            <article className="reason-card ablation-card"><p className="eyebrow">Ablation · {workspace.ablation.label}</p><p>{workspace.ablation.result}</p></article>
          </section>

          <LineagePath proof={workspace.graphProof} traversal={workspace.traversal} />
        </div>
      )}
    </section>
  );
}
