import Link from "next/link";

import { NodeFlower } from "./visual-motifs";

export function LandingHeader() {
  return (
    <header className="landing-header">
      <a className="landing-brand" href="#top" aria-label="SourceTruce home">
        <NodeFlower className="landing-brand-mark" />
        <span><strong>SourceTruce</strong><small>Evidence, cross-examined</small></span>
      </a>
      <nav aria-label="Product navigation">
        <a href="#method">Method</a>
        <a href="#cases">Cases</a>
        <a href="#architecture">Architecture</a>
        <Link className="nav-cta" href="/workspace"><span>Open console</span><i aria-hidden="true">↗</i></Link>
      </nav>
    </header>
  );
}
