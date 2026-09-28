import { timingSafeEqual } from "node:crypto";
import { API } from "@/lib/config";
import { discover } from "@/lib/discover";
import { evaluateDue } from "@/lib/evaluate";
import { scanPending } from "@/lib/safety";

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Called hourly by the GitHub Actions workflow: log new trending coins, scan their contracts, then update due checkpoints. */
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const missing = ["DATABASE_URL", "COINGECKO_DEMO_API_KEY"].filter((name) => !process.env[name]);
  if (missing.length) return Response.json({ error: `Missing env vars: ${missing.join(", ")}` }, { status: 500 });

  const started = Date.now();
  const deadline = started + API.runBudgetMs;

  const discovery = await discover(deadline);
  // Safety scans are time-sensitive (they should reflect entry), so they run before price checks.
  const safety = await scanPending(deadline);
  const evaluation = discovery.rateLimited ? null : await evaluateDue(deadline);

  return Response.json({ discovery, safety, evaluation, ms: Date.now() - started });
}
