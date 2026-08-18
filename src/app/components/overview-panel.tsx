import { StatusIcon } from "./status-icon";

export function OverviewPanel() {
  return (
    <section className="overview-panel" id="top" aria-labelledby="overview-title">
      <div className="overview-copy">
        <p className="eyebrow">Evidence lineage console</p>
        <h1 id="overview-title">Answers you can trace.<br />Conflicts you can inspect.</h1>
        <p>Cross-examine real enterprise records through a provenance-aware ontology. Every verdict keeps its sources, decisions, coverage boundary, and native HydraDB path in view.</p>
      </div>
      <div className="capability-grid" aria-label="System capabilities">
        <article><span className="capability-icon terminal"><StatusIcon name="database" /></span><div><strong>Real records</strong><small>ERB + HERB cases</small></div></article>
        <article><span className="capability-icon mint"><StatusIcon name="shield" /></span><div><strong>Fail closed</strong><small>No cached verdicts</small></div></article>
        <article><span className="capability-icon peach"><StatusIcon name="lineage" /></span><div><strong>Graph native</strong><small>Inspectable paths</small></div></article>
        <article><span className="capability-icon blue"><StatusIcon name="spark" /></span><div><strong>Local extraction</strong><small>QVAC inference</small></div></article>
      </div>
    </section>
  );
}
