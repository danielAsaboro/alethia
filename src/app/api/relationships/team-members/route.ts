import { NextResponse } from "next/server";
import { z } from "zod";

import { HydraRepository } from "@/hydra/client";

export const dynamic = "force-dynamic";

const querySchema = z.string().regex(/^entity_[a-f0-9]{24}$/);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const entityId = querySchema.safeParse(url.searchParams.get("entityId"));
  if (!entityId.success) {
    return NextResponse.json({ error: "invalid_entity_id" }, { status: 400 });
  }
  const repository = new HydraRepository({
    httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443",
    token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes",
    graphId: process.env.HYDRA_GRAPH_ID ?? "default",
    namespace: process.env.HYDRA_NAMESPACE ?? "default",
    cellId: process.env.HYDRA_CELL_ID ?? "cell-0",
  });
  try {
    const members = await repository.findTeamMemberEvidence(entityId.data);
    return NextResponse.json({
      startEntityLogicalId: entityId.data,
      traversal:
        "(Product)-[:HAS_TEAM_MEMBER]->(Person)-[:ASSERTS]->(Claim)-[:SUPPORTED_BY]->(SourceObject)",
      memberCount: members.length,
      members,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "hydradb_unavailable",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  } finally {
    await repository.close();
  }
}
