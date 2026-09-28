import { db } from "@/lib/db";
import { TRACKING } from "@/lib/config";
import { RateLimitError, hourlyCandles } from "@/lib/gecko";
import { checkpointDueAt, computeMetrics, hourlyCloses } from "@/lib/metrics";

export type EvaluationResult = {
  evaluated: number;
  finished: number;
  errors: number;
  rateLimited: boolean;
  stillDue: number;
};

/** Pull price history for coins whose next checkpoint has passed. */
export async function evaluateDue(deadline: number): Promise<EvaluationResult> {
  const result: EvaluationResult = { evaluated: 0, finished: 0, errors: 0, rateLimited: false, stillDue: 0 };
  const skip = new Set<string>();

  // Leave a few seconds for the DB write after the last fetch.
  while (Date.now() < deadline - 4_000) {
    const now = new Date();
    const token = await db().token.findFirst({
      where: { status: "TRACKING", nextCheckAt: { lte: now }, id: { notIn: [...skip] } },
      orderBy: { nextCheckAt: "asc" },
    });
    if (!token) break;
    skip.add(token.id);

    try {
      const hoursSinceEntry = (now.getTime() - token.entryAt.getTime()) / 3_600_000;
      const candles = await hourlyCandles(token.network, token.poolAddress, hoursSinceEntry + 3);
      const closes = hourlyCloses(token.entryAt, token.entryPrice, candles, now, TRACKING.horizonHours);
      const metrics = computeMetrics(token.entryPrice, closes);

      const done = closes.length >= TRACKING.horizonHours;
      const nextCheckpoint = TRACKING.checkpointsHours.find((h) => h > closes.length) ?? TRACKING.horizonHours;

      await db().token.update({
        where: { id: token.id },
        data: {
          ...metrics,
          closes,
          hoursTracked: closes.length,
          status: done ? "DONE" : "TRACKING",
          nextCheckAt: done ? token.nextCheckAt : checkpointDueAt(token.entryAt, nextCheckpoint, TRACKING.settleMinutes),
          errorCount: 0,
          lastError: null,
        },
      });
      result.evaluated++;
      if (done) result.finished++;
    } catch (error) {
      if (error instanceof RateLimitError) {
        result.rateLimited = true;
        break;
      }
      const errorCount = token.errorCount + 1;
      await db().token.update({
        where: { id: token.id },
        data: {
          errorCount,
          lastError: error instanceof Error ? error.message.slice(0, 500) : "unknown error",
          status: errorCount >= TRACKING.maxErrors ? "FAILED" : "TRACKING",
          nextCheckAt: new Date(Date.now() + 60 * 60_000),
        },
      });
      result.errors++;
    }
  }

  result.stillDue = await db().token.count({ where: { status: "TRACKING", nextCheckAt: { lte: new Date() } } });
  return result;
}
