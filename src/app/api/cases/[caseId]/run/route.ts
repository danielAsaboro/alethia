import { NextResponse } from "next/server";

import { runJudgeCase } from "@/application/run-case";
import { getJudgeCase } from "@/cases/case-registry";
import { HydraRepository } from "@/hydra/client";

export const dynamic = "force-dynamic";

function repository(): HydraRepository {
  return new HydraRepository({
    httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443",
    token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes",
    graphId: process.env.HYDRA_GRAPH_ID ?? "default",
    namespace: process.env.HYDRA_NAMESPACE ?? "default",
    cellId: process.env.HYDRA_CELL_ID ?? "cell-0",
  });
}

export async function POST(_request: Request, context: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await context.params;
  if (!getJudgeCase(caseId)) return NextResponse.json({ error: "case_not_found" }, { status: 404 });
  const hydra = repository();
  try {
    return NextResponse.json(await runJudgeCase(caseId, hydra));
  } catch (error) {
    return NextResponse.json({
      error: "case_unavailable",
      detail: error instanceof Error ? error.message : String(error),
    }, { status: 503 });
  } finally {
    await hydra.close();
  }
}
