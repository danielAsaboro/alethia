import Link from "next/link";

import { EvidencePipeline } from "./components/evidence-pipeline";
import { LandingHeader } from "./components/landing-header";

export default function Home() {
  return (
    <main className="landing-shell" id="top">
      <LandingHeader />

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="kicker">Enterprise answers, cross-examined.</p>
          <h1 id="hero-title">Every answer should survive the evidence.</h1>
          <p className="hero-intro">
            SourceTruce turns conflicting enterprise records into inspectable claims, decisions, and graph-native proof.
          </p>
          <div className="hero-actions">
            <Link className="button" href="/workspace">Open evidence console <span aria-hidden="true">→</span></Link>
            <a className="text-link" href="#method">See the evidence method <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <aside className="hero-docket" aria-label="System docket">
          <p className="docket-label">System docket / 01</p>
          <dl>
            <div><dt>Records</dt><dd>Enterprise RAG Bench + Salesforce HERB</dd></div>
            <div><dt>Provenance</dt><dd>Claim-level source evidence</dd></div>
            <div><dt>Conflict</dt><dd>Inspectable resolution decisions</dd></div>
            <div><dt>Traversal</dt><dd>Native HydraDB paths</dd></div>
          </dl>
        </aside>
      </section>

      <section className="method-section" id="method" aria-labelledby="method-title">
        <div className="section-heading">
          <p className="kicker">The evidence method</p>
          <h2 id="method-title">From source record to defensible answer.</h2>
          <p>No flattened chunks. No invisible tie-breakers. The complete reasoning structure remains inspectable.</p>
        </div>
        <EvidencePipeline />
      </section>

      <section className="principle-grid" aria-label="SourceTruce operating principles">
        <article className="principle-conflict">
          <p className="docket-label">Conflict / retained</p>
          <h2>Disagreement is data.</h2>
          <p>Competing claims stay visible with the authority, identity, and lifecycle rules used to resolve—or preserve—the dispute.</p>
          <span className="principle-stamp">NO SILENT WINNERS</span>
        </article>
        <article className="principle-boundary">
          <p className="docket-label">Knowledge boundary / enforced</p>
          <h2>Absence must be proven.</h2>
          <p>SourceTruce returns NOT_FOUND only when coverage is complete. Incomplete evidence produces UNKNOWN, not manufactured certainty.</p>
          <span className="principle-stamp">FAIL CLOSED</span>
        </article>
      </section>

      <section className="architecture" id="architecture" aria-labelledby="architecture-title">
        <div className="architecture-copy">
          <p className="kicker">Graph-native by construction</p>
          <h2 id="architecture-title">The proof is part of the answer.</h2>
          <p>HydraDB stores the ontology and returns the actual path used to connect claims, decisions, and source objects.</p>
          <Link className="button button-light" href="/workspace">Inspect a live path <span aria-hidden="true">→</span></Link>
        </div>
        <div className="architecture-exhibit" aria-label="HydraDB path operations">
          <div className="exhibit-head"><span>Native operation</span><strong>HYDRA / PATH PROOF</strong></div>
          <code>algo.SPpaths</code>
          <div className="path-rule" aria-hidden="true"><i /><i /><i /><i /></div>
          <code>algo.SPpaths.sequence</code>
          <p>Strong-consistency reads return the traversal, relationship sequence, query ID, epoch, bookmark, and round-trip evidence.</p>
        </div>
      </section>

      <section className="dataset-note" aria-labelledby="dataset-title">
        <p className="kicker">Real records only</p>
        <h2 id="dataset-title">Built against enterprise evidence, not invented demos.</h2>
        <div>
          <p><strong>Enterprise RAG Bench</strong><span>Conflicts, supersession, alignment, and authority.</span></p>
          <p><strong>Salesforce HERB</strong><span>Identity, canonical facts, multi-hop teams, and coverage.</span></p>
        </div>
      </section>

      <section className="final-cta">
        <div><p className="kicker">The record is ready.</p><h2>Cross-examine the graph.</h2></div>
        <Link className="button button-dark" href="/workspace">Open evidence console <span aria-hidden="true">→</span></Link>
      </section>
    </main>
  );
}
