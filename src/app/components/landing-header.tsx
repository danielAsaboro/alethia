import Link from "next/link";

export function LandingHeader() {
  return (
    <header className="landing-header">
      <a className="landing-brand" href="#top" aria-label="SourceTruce home">
        <span className="landing-brand-mark" aria-hidden="true">ST</span>
        <span><strong>SourceTruce</strong><small>Evidence intelligence</small></span>
      </a>
      <nav aria-label="Product navigation">
        <a href="#method">Method</a>
        <a href="#architecture">Architecture</a>
        <Link className="button button-small" href="/workspace">Open evidence console</Link>
      </nav>
    </header>
  );
}
