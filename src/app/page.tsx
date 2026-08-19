import Image from "next/image";
import Link from "next/link";

import { listJudgeCases } from "@/cases/case-registry";
import { EvidencePipeline } from "./components/evidence-pipeline";
import { LandingHeader } from "./components/landing-header";
import { MotionReveal } from "./components/motion-reveal";
import { CircleChain, CoverageGlyph, OrbitBadge } from "./components/visual-motifs";

const capabilities = [
  ["Conflict resolution", "Keep competing claims and the rule that selected—or refused—a winner."],
  ["Identity alignment", "Accept and reject entity links with inspectable constraints."],
  ["Source lifecycle", "Retain current, stale, and superseded records in the evidence structure."],
  ["Coverage boundaries", "Separate proven absence from incomplete knowledge."],
  ["Multi-hop traversal", "Return the graph path that materially produced the answer."],
] as const;

export default function Home() {
  const cases = listJudgeCases().slice(0, 2);

  return (
    <main className="atelier-shell" id="top">
      <LandingHeader />

      <section className="atelier-hero" aria-label="Evidence Atelier hero">
        <p className="hero-kicker">Enterprise evidence / resolved in public</p>
        <h1><span>MAKE CONFLICT</span><span>EXPLAIN ITSELF</span></h1>
        <CircleChain className="hero-chain" count={7} />
        <Image className="hero-sculpture float-object" src="/visuals/evidence-sculpture.png" width={1024} height={1536} priority alt="" />
        <Link className="round-cta hero-cta" href="/workspace"><span>Open<br />console</span><i aria-hidden="true">↗</i></Link>
        <dl className="hero-facts">
          <div><dt>Records</dt><dd>ERB + HERB</dd></div>
          <div><dt>Provenance</dt><dd>Claim-level</dd></div>
          <div><dt>Traversal</dt><dd>HydraDB native</dd></div>
        </dl>
      </section>

      <MotionReveal>
        <section className="atelier-manifesto" id="method" aria-labelledby="manifesto-title">
          <p className="section-note">Not another retrieval wrapper.<br />An evidence system.</p>
          <h2 id="manifesto-title"><span>RECORDS STAY VISIBLE.</span><span>DECISIONS STAY INSPECTABLE.</span><span>ABSENCE MUST BE PROVEN.</span></h2>
          <EvidencePipeline />
        </section>
      </MotionReveal>

      <MotionReveal>
        <section className="capability-section" aria-label="SourceTruce capabilities">
          <div className="coverage-figures" aria-label="Coverage states">
            <div><CoverageGlyph sufficient={false} /><span>Incomplete evidence</span></div>
            <div><CoverageGlyph sufficient /><span>Covered slice</span></div>
          </div>
          <div className="capability-copy">
            <p className="section-note">What the ontology keeps on the record</p>
            <ol>
              {capabilities.map(([title, detail], index) => (
                <li key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{title}</strong><p>{detail}</p></div></li>
              ))}
            </ol>
          </div>
        </section>
      </MotionReveal>

      <MotionReveal>
        <section className="case-showcase" id="cases" aria-label="Real judge case preview">
          <Image className="showcase-cluster float-object" src="/visuals/source-object-cluster.png" width={1536} height={1024} alt="" />
          <div className="showcase-heading"><p className="section-note">Real records. Real questions.</p><h2>Cross-examine a case.</h2></div>
          <div className="preview-cards">
            {cases.map((item, index) => (
              <article key={item.id} className="preview-card">
                <div className="preview-meta"><span>{String(index + 1).padStart(2, "0")} / {item.kind.replaceAll("_", " ")}</span><small>{item.dataset}</small></div>
                <h3>{item.title}</h3>
                <p>{item.summary}</p>
                <Link href="/workspace" aria-label={`Open ${item.title} in the evidence console`}>↗</Link>
                <b aria-hidden="true">0{index + 1}</b>
              </article>
            ))}
          </div>
        </section>
      </MotionReveal>

      <MotionReveal>
        <section className="evidence-collage" aria-label="Evidence object system">
          <Image className="collage-ring ring-one float-object" src="/visuals/evidence-ring.png" width={1254} height={1254} alt="" />
          <Image className="collage-ring ring-two float-object" src="/visuals/evidence-ring.png" width={1254} height={1254} alt="" />
          <div className="collage-disc disc-record"><span>Source record</span></div>
          <div className="collage-disc disc-claim"><span>Competing claim</span></div>
          <div className="collage-disc disc-decision"><span>Resolution decision</span></div>
          <CircleChain className="collage-chain" count={9} />
          <p>Every value keeps its source.<br />Every conflict keeps its losing claim.</p>
        </section>
      </MotionReveal>

      <section className="atelier-architecture" id="architecture" aria-label="HydraDB evidence architecture">
        <div className="architecture-orbits" aria-label="Record to proof ontology">
          <OrbitBadge label="Record" index="01" tone="yellow" />
          <OrbitBadge label="Claim" index="02" tone="blue" />
          <OrbitBadge label="Decision" index="03" tone="lime" />
          <OrbitBadge label="Proof" index="04" tone="pink" />
          <Image className="architecture-sculpture" src="/visuals/evidence-sculpture.png" width={1024} height={1536} alt="" />
        </div>
        <div className="architecture-copy">
          <p className="section-note">Graph-native by construction</p>
          <h2>THE PROOF IS PART OF THE ANSWER.</h2>
          <code>algo.SPpaths</code><code>algo.SPpaths.sequence</code>
          <p>Strong-consistency reads return the path, relationship sequence, query ID, epoch, bookmark, latency, and round-trip evidence.</p>
          <Link className="round-cta architecture-cta" href="/workspace"><span>Inspect<br />a path</span><i aria-hidden="true">↗</i></Link>
        </div>
        <footer><span>Enterprise RAG Bench</span><span>Salesforce HERB</span><strong>SourceTruce</strong></footer>
      </section>
    </main>
  );
}
