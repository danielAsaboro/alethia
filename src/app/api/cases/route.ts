import { NextResponse } from "next/server";
import { listJudgeCases } from "@/cases/case-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ cases: listJudgeCases() });
}
