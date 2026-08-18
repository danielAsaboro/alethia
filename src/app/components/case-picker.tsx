import type { JudgeCase } from "@/cases/case-registry";

export function CasePicker({ cases, selectedId, onRun, loading }: { cases: JudgeCase[]; selectedId: string; onRun: (caseValue: JudgeCase) => void; loading: boolean }) {
  return (
    <aside className="case-panel">
      <div className="panel-heading"><div><p className="eyebrow">Question library</p><h2>Judge cases</h2></div><span className="count-badge">{cases.length}</span></div>
      <p className="panel-intro">Run a real question against the live evidence graph.</p>
      <nav className="case-list" aria-label="Judge cases">
        {cases.length === 0 && <div className="case-list-empty" role="status">No judge cases are configured.</div>}
        {cases.map((item, index) => (
          <button key={item.id} type="button" className={`case-card ${selectedId === item.id ? "selected" : ""}`} onClick={() => onRun(item)} disabled={loading} aria-pressed={selectedId === item.id} aria-busy={loading && selectedId === item.id}>
            <span className="case-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="case-copy"><span className="case-meta"><em>{item.behavior.replaceAll("_", " ")}</em><small>{item.dataset}</small></span><strong>{item.title}</strong><span className="case-summary">{item.summary}</span></span>
            <span className="case-arrow" aria-hidden="true">→</span>
          </button>
        ))}
      </nav>
      <p className="fail-closed"><strong>Fail closed:</strong> if HydraDB is unavailable or the required path is missing, SourceTruce issues no verdict.</p>
    </aside>
  );
}
