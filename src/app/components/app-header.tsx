import { StatusIcon } from "./status-icon";

export function AppHeader() {
  return (
    <header className="app-header" aria-label="SourceTruce application header">
      <a className="brand" href="#top" aria-label="SourceTruce home">
        <span className="brand-mark"><StatusIcon name="lineage" /></span>
        <span className="brand-copy"><strong>SourceTruce</strong><small>Evidence intelligence</small></span>
      </a>
      <nav className="primary-nav" aria-label="Workspace sections">
        <a className="active" href="#workspace">Workspace</a>
        <a href="#lineage-principles">Ontology</a>
        <a href="#lineage-principles">Sources</a>
      </nav>
      <div className="system-state"><span className="pulse" /><span><strong>Live system</strong><small>HydraDB + local QVAC</small></span></div>
    </header>
  );
}
