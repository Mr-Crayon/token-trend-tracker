import type { Candle } from "@/lib/gecko";

const HOUR_MS = 3_600_000;

/** Start of the first full hourly candle after the coin was logged. */
export function firstFullHour(entryAt: Date): number {
  return Math.floor(entryAt.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS;
}

/** When checkpoint `hours` has fully closed and is safe to fetch. */
export function checkpointDueAt(entryAt: Date, hours: number, settleMinutes: number): Date {
  return new Date(firstFullHour(entryAt) + hours * HOUR_MS + settleMinutes * 60_000);
}

/**
 * Hourly closes after entry, one per fully closed hour, forward-filled through
 * hours with no trades. Uses closes rather than highs so a single odd wick
 * can't fake a 10x.
 */
export function hourlyCloses(entryAt: Date, entryPrice: number, candles: Candle[], now: Date, horizonHours: number): number[] {
  const start = firstFullHour(entryAt);
  const completed = Math.min(horizonHours, Math.floor((now.getTime() - start) / HOUR_MS));
  if (completed <= 0) return [];

  const closeByStart = new Map<number, number>();
  let last = entryPrice;
  for (const [ts, , , , close] of candles) {
    const ms = ts * 1000;
    if (close > 0) {
      if (ms < start) last = close; // latest trade before the first full hour
      else closeByStart.set(ms, close);
    }
  }

  const closes: number[] = [];
  for (let i = 0; i < completed; i++) {
    last = closeByStart.get(start + i * HOUR_MS) ?? last;
    closes.push(last);
  }
  return closes;
}

export type Metrics = {
  ret1d: number | null;
  ret3d: number | null;
  ret7d: number | null;
  peakMultiple: number | null;
  hoursToPeak: number | null;
  drawdownAfterPeak: number | null;
};

export function computeMetrics(entryPrice: number, closes: number[]): Metrics {
  const retAt = (h: number) => (closes.length >= h ? closes[h - 1] / entryPrice - 1 : null);

  if (closes.length === 0) {
    return { ret1d: null, ret3d: null, ret7d: null, peakMultiple: null, hoursToPeak: null, drawdownAfterPeak: null };
  }

  let peakIdx = 0;
  closes.forEach((c, i) => {
    if (c > closes[peakIdx]) peakIdx = i;
  });
  const peak = closes[peakIdx];
  const lowAfter = Math.min(...closes.slice(peakIdx));

  return {
    ret1d: retAt(24),
    ret3d: retAt(72),
    ret7d: retAt(168),
    peakMultiple: peak / entryPrice,
    hoursToPeak: peakIdx + 1,
    drawdownAfterPeak: 1 - lowAfter / peak,
  };
}

export type SimRules = {
  takeProfitMultiple: number;
  takeProfitFraction: number;
  trailPct: number;
  feePct: number;
};

/**
 * Buy at entry, sell `takeProfitFraction` the first hour it closes at or above
 * `takeProfitMultiple`, and sell everything left the first hour it closes
 * `trailPct` below its highest close so far. Whatever is left is sold at the
 * last close. Returns profit as a fraction of the stake (0.25 = +25%).
 */
export function simulate(entryPrice: number, closes: number[], rules: SimRules): number | null {
  if (closes.length === 0 || entryPrice <= 0) return null;
  const { takeProfitMultiple, takeProfitFraction, trailPct, feePct } = rules;

  let tokens = (1 - feePct) / entryPrice;
  let cash = 0;
  let high = entryPrice;
  let tookProfit = false;

  for (const price of closes) {
    high = Math.max(high, price);
    if (!tookProfit && price >= entryPrice * takeProfitMultiple) {
      const sold = tokens * takeProfitFraction;
      cash += sold * price * (1 - feePct);
      tokens -= sold;
      tookProfit = true;
    }
    if (tokens > 0 && price <= high * (1 - trailPct)) {
      cash += tokens * price * (1 - feePct);
      tokens = 0;
      break;
    }
  }

  if (tokens > 0) cash += tokens * closes[closes.length - 1] * (1 - feePct);
  return cash - 1;
}
