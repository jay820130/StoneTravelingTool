import { timingSafeEqual } from "node:crypto";
import { processOneJob } from "@/lib/worker";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  const actual = req.headers.get("authorization") ?? "";
  const expectedBytes = Buffer.from(`Bearer ${expected ?? ""}`);
  const actualBytes = Buffer.from(actual);
  if (
    !expected ||
    actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes)
  )
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  try {
    return Response.json(await processOneJob(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Worker unavailable" }, { status: 503 });
  }
}
