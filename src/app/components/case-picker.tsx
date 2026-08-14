import type { JudgeCase } from "@/cases/case-registry";

export function CasePicker({ cases, selectedId, onRun, loading }: { cases: JudgeCase[]; selectedId: string; onRun: (caseValue: JudgeCase) => void; loading: boolean }) {
  return (
    <section className="case-panel">
      <div className="section-heading"><span>01</span><div><p className="eyebrow">Real judge cases</p><h2>Choose the cross-examination</h2></div></div>
      <div className="case-list">
        {cases.map((item, index) => (
          <button key={item.id} type="button" className={`case-card ${selectedId === item.id ? "selected" : ""}`} onClick={() => onRun(item)} disabled={loading}>
            <span className="case-index">0{index + 1}</span>
            <span className="case-copy"><strong>{item.title}</strong><small>{item.summary}</small><em>{item.dataset}</em></span>
            <span className="case-arrow">↗</span>
          </button>
        ))}
      </div>
      <p className="fail-closed"><strong>Fail closed:</strong> if HydraDB is unavailable or the required path is missing, SourceTruce issues no verdict.</p>
    </section>
  );
}
