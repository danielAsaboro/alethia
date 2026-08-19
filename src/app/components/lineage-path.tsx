import type { WorkspaceResult } from "./evidence-workspace";
import { StatusIcon } from "./status-icon";

export function LineagePath({ proof, traversal }: { proof: WorkspaceResult["graphProof"]; traversal: string }) {
  return (
    <section className="lineage-card lineage-canvas" aria-label="HydraDB lineage path">
      <div className="lineage-head">
        <div><span className="lineage-icon"><StatusIcon name="lineage" /></span><div><p className="eyebrow">HydraDB native path</p><h3>{proof.operation}</h3></div></div>
        <span className="consistency-badge"><i />{proof.consistency} consistency</span>
      </div>
      <div className="lineage-flow" aria-label={`Relationship sequence: ${proof.relationshipTypes.join(" to ")}`}>
        {proof.relationshipTypes.map((relationship, index) => <span className="relationship-step" key={`${relationship}-${index}`}><i aria-hidden="true" /><span className="relationship-chip">{relationship}</span></span>)}
        <span className="relationship-step proof-step"><i aria-hidden="true" /><span className="relationship-chip">PROOF</span></span>
      </div>
      <code className="lineage-path-code">{proof.path}</code>
      <dl className="lineage-metrics">
        <div><dt>Round trips</dt><dd>{proof.roundTrips} {proof.roundTrips === 1 ? "round trip" : "round trips"}</dd></div>
        <div><dt>Path length</dt><dd>{proof.pathLength}</dd></div>
        <div><dt>Client latency</dt><dd>{proof.latencyMs.toFixed(2)} ms</dd></div>
        <div><dt>Read epoch</dt><dd>{proof.readEpoch ?? "Unavailable"}</dd></div>
      </dl>
      <div className="lineage-details">
        <div><span>Query ID</span><code>{proof.queryId}</code></div>
        <div><span>Bookmark</span><code>{proof.bookmark ?? "Unavailable"}</code></div>
        <div><span>Traversal</span><code>{traversal}</code></div>
      </div>
    </section>
  );
}
