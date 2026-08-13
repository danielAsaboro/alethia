"use client";

import { FormEvent, useState } from "react";

interface DossierClaim {
  id: string;
  predicate: string;
  object:
    | { kind: "literal"; value: string | number | boolean }
    | { kind: "entity"; entityId: string };
  sourceObjectId: string;
  sourceSystem: string;
}

interface Dossier {
  question: string;
  verdict: "SUPPORTED" | "DISPUTED" | "NOT_FOUND" | "UNKNOWN";
  reason: string;
  answerClaims: DossierClaim[];
  evidence: Array<{ claim: DossierClaim; sourceLabel: string }>;
  coverage: {
    sufficient: boolean;
    missing: Array<{
      sourceSystem: string;
      objectType: string;
      predicateFamily: string;
      reason: string;
    }>;
  };
}

const verdicts = [
  ["SUPPORTED", "Evidence agrees or policy resolves the conflict."],
  ["DISPUTED", "Credible claims remain incompatible."],
  ["NOT_FOUND", "Required evidence was examined and the fact is absent."],
  ["UNKNOWN", "Coverage or identity resolution is insufficient."],
] as const;

function claimValue(claim: DossierClaim): string {
  return claim.object.kind === "literal"
    ? String(claim.object.value)
    : claim.object.entityId;
}

export default function Home() {
  const [question, setQuestion] = useState("What is this person's role?");
  const [entityLogicalId, setEntityLogicalId] = useState(
    "entity_90ad19476a96ae677e3c9143",
  );
  const [predicate, setPredicate] = useState("has_role");
  const [predicateFamily, setPredicateFamily] = useState("role");
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setError("");
    setDossier(null);
    try {
      const response = await fetch("/api/dossiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          entityLogicalId,
          predicate,
          sourceSystem: "herb",
          objectType: "employee",
          predicateFamily,
          contentScope: "metadata",
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.detail ?? body.error ?? "Evidence query failed");
      }
      setDossier(body as Dossier);
      setStatus("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("error");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="SourceTruce home">
          <span className="brand-mark">ST</span>
          <span>SourceTruce</span>
        </a>
        <div className="system-state">
          <span className="pulse" />
          Local evidence plane
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">Enterprise evidence court</p>
          <h1>Know what happened.<br />Know whether you can know.</h1>
          <p className="lede">
            SourceTruce resolves identities, preserves competing claims, and
            qualifies every negative answer with actual ingestion coverage.
            The verdict comes from HydraDB paths—not nearest-neighbor prose.
          </p>
        </div>
        <div className="proof-card">
          <p className="proof-label">Last verified local run</p>
          <div className="proof-grid">
            <div><strong>8,177</strong><span>graph nodes</span></div>
            <div><strong>18,220</strong><span>relationships</span></div>
            <div><strong>5,130</strong><span>claims</span></div>
            <div><strong>0</strong><span>extraction gaps</span></div>
          </div>
          <p className="proof-foot">HERB · HydraDB OSS 0.1.0 · local only</p>
        </div>
      </section>

      <section className="verdict-strip" aria-label="Verdict definitions">
        {verdicts.map(([name, description]) => (
          <article key={name} className={`verdict-definition ${name.toLowerCase()}`}>
            <strong>{name}</strong>
            <span>{description}</span>
          </article>
        ))}
      </section>

      <section className="workspace">
        <form className="query-panel" onSubmit={submit}>
          <div className="section-heading">
            <span>01</span>
            <div>
              <p className="eyebrow">Structured query</p>
              <h2>Put the graph on the stand</h2>
            </div>
          </div>

          <label>
            Question
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
            />
          </label>
          <label>
            Canonical entity ID
            <input
              value={entityLogicalId}
              onChange={(event) => setEntityLogicalId(event.target.value)}
            />
          </label>
          <div className="field-row">
            <label>
              Predicate
              <input
                value={predicate}
                onChange={(event) => setPredicate(event.target.value)}
              />
            </label>
            <label>
              Coverage family
              <input
                value={predicateFamily}
                onChange={(event) => setPredicateFamily(event.target.value)}
              />
            </label>
          </div>
          <button type="submit" disabled={status === "loading"}>
            {status === "loading" ? "Traversing HydraDB…" : "Run evidence query"}
          </button>
          <p className="fail-closed">
            <strong>HydraDB unavailable?</strong> SourceTruce returns no verdict.
            There is no in-memory success fallback.
          </p>
        </form>

        <section className="dossier-panel" aria-live="polite">
          <div className="section-heading">
            <span>02</span>
            <div>
              <p className="eyebrow">Decision dossier</p>
              <h2>Verdict and chain of custody</h2>
            </div>
          </div>

          {status === "loading" && (
            <div className="empty-state"><div className="loader" /><p>Traversing claims, sources, and coverage…</p></div>
          )}
          {status === "error" && (
            <div className="error-state">
              <p className="eyebrow">HydraDB unavailable</p>
              <h3>No verdict issued</h3>
              <p>{error}</p>
            </div>
          )}
          {status === "idle" && !dossier && (
            <div className="empty-state">
              <div className="empty-glyph">↗</div>
              <h3>Evidence is waiting</h3>
              <p>Run the verified HERB query or enter another canonical entity.</p>
            </div>
          )}
          {dossier && (
            <div className="dossier">
              <div className="dossier-verdict">
                <span className={`verdict-badge ${dossier.verdict.toLowerCase()}`}>
                  {dossier.verdict}
                </span>
                <p>{dossier.question}</p>
              </div>
              <div className="answer-block">
                <p className="eyebrow">Answer</p>
                <h3>
                  {dossier.answerClaims.length
                    ? dossier.answerClaims.map(claimValue).join(" · ")
                    : dossier.reason.replaceAll("_", " ")}
                </h3>
              </div>
              <div className="evidence-list">
                <p className="eyebrow">Evidence path</p>
                {dossier.evidence.map(({ claim, sourceLabel }, index) => (
                  <article key={claim.id} className="evidence-row">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{claim.predicate} → {claimValue(claim)}</strong>
                      <p>{sourceLabel}</p>
                    </div>
                  </article>
                ))}
                {!dossier.evidence.length && <p>No applicable claim path exists.</p>}
              </div>
              <div className={`coverage-card ${dossier.coverage.sufficient ? "complete" : "incomplete"}`}>
                <p className="eyebrow">Coverage gate</p>
                <strong>{dossier.coverage.sufficient ? "Required slice examined" : "Knowledge boundary detected"}</strong>
                {dossier.coverage.missing.map((gap) => (
                  <p key={`${gap.sourceSystem}-${gap.objectType}-${gap.predicateFamily}`}>
                    {gap.sourceSystem}/{gap.objectType}/{gap.predicateFamily}: {gap.reason}
                  </p>
                ))}
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
