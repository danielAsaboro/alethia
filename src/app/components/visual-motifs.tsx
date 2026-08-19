import type { CSSProperties } from "react";

export function NodeFlower({ className = "" }: { className?: string }) {
  return (
    <span className={`node-flower ${className}`} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

export function CircleChain({
  className = "",
  label,
  count = 5,
  striped = false,
}: {
  className?: string;
  label?: string;
  count?: number;
  striped?: boolean;
}) {
  return (
    <span
      className={`circle-chain ${striped ? "striped" : ""} ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {Array.from({ length: count }, (_, index) => <i key={index} />)}
    </span>
  );
}

export function CoverageGlyph({ sufficient }: { sufficient: boolean }) {
  return (
    <span className={`coverage-glyph ${sufficient ? "sufficient" : "incomplete"}`} role="img" aria-label={sufficient ? "Coverage sufficient" : "Coverage incomplete"}>
      <i /><i />
    </span>
  );
}

export function OrbitBadge({ label, index, tone }: { label: string; index: string; tone: "pink" | "blue" | "lime" | "yellow" }) {
  return (
    <span className={`orbit-badge ${tone}`} style={{ "--orbit-index": `"${index}"` } as CSSProperties}>
      <span>{label}</span>
    </span>
  );
}
