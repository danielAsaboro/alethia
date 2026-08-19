import Link from "next/link";

import { StatusIcon } from "./status-icon";

type SystemStatus = "unverified" | "loading" | "verified" | "error";

const statusCopy: Record<SystemStatus, { label: string; detail: string }> = {
  unverified: { label: "System unverified", detail: "Run a live case" },
  loading: { label: "Query in progress", detail: "HydraDB request active" },
  verified: { label: "Live proof verified", detail: "HydraDB + local QVAC" },
  error: { label: "System unavailable", detail: "No verdict issued" },
};

export function AppHeader({ status }: { status: SystemStatus }) {
  const copy = statusCopy[status];
  return (
    <header className="app-header" aria-label="SourceTruce application header">
      <Link className="brand" href="/" aria-label="SourceTruce home">
        <span className="brand-mark"><StatusIcon name="lineage" /></span>
        <span className="brand-copy"><strong>SourceTruce</strong><small>Evidence console</small></span>
      </Link>
      <nav className="primary-nav" aria-label="Workspace sections">
        <a className="active" href="#workspace">Workspace</a>
        <Link href="/#method">Method</Link>
      </nav>
      <div className={`system-state ${status}`}><span className="pulse" /><span><strong>{copy.label}</strong><small>{copy.detail}</small></span></div>
    </header>
  );
}
