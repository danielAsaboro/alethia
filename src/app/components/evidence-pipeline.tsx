import { CircleChain } from "./visual-motifs";

const stages = [
  ["Record", "Preserve the enterprise source and its exact evidence."],
  ["Claim", "Represent each asserted value independently."],
  ["Conflict", "Keep competing claims visible instead of averaging them away."],
  ["Decision", "Apply inspectable authority, identity, and coverage rules."],
  ["Evidence", "Return the sources and graph path with the answer."],
] as const;

export function EvidencePipeline() {
  return (
    <div className="pipeline-wrap">
      <CircleChain className="pipeline-chain" count={5} striped label="Records resolve through claims, conflicts, decisions, and evidence" />
      <ol className="evidence-pipeline" aria-label="Evidence resolution method">
        {stages.map(([title, detail], index) => (
          <li key={title}>
            <span className="pipeline-index">0{index + 1}</span>
            <strong>{title}</strong>
            <p>{detail}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
