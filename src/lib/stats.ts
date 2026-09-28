import { db } from "@/lib/db";
import { NETWORKS, RUN_UP_BUCKETS, SIM_DEFAULTS, TRACKING } from "@/lib/config";
import { simulate, type SimRules } from "@/lib/metrics";

export type Summary = {
  n: number;
  upPct: number | null;
  median: number | null;
  doubledPct: number | null;
  halvedPct: number | null;
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function share(values: number[], test: (v: number) => boolean): number | null {
  return values.length ? values.filter(test).length / values.length : null;
}

function summarize(values: number[]): Summary {
  return {
    n: values.length,
    upPct: share(values, (v) => v > 0),
    median: median(values),
    doubledPct: share(values, (v) => v >= 1),
    halvedPct: share(values, (v) => v <= -0.5),
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Read exit rules from the URL. Percent inputs arrive as whole numbers (50 = 50%). */
export function parseRules(params: Record<string, string | string[] | undefined>): SimRules {
  return {
    takeProfitMultiple: clamp(params.tp, 1.1, 100, SIM_DEFAULTS.takeProfitMultiple),
    takeProfitFraction: clamp(params.sell, 0, 100, SIM_DEFAULTS.takeProfitFraction * 100) / 100,
    trailPct: clamp(params.trail, 5, 95, SIM_DEFAULTS.trailPct * 100) / 100,
    feePct: SIM_DEFAULTS.feePct,
  };
}

export async function loadDashboard(rules: SimRules) {
  const tokens = await db().token.findMany({
    orderBy: { entryAt: "desc" },
    select: {
      id: true,
      network: true,
      poolAddress: true,
      symbol: true,
      status: true,
      entryAt: true,
      entryPrice: true,
      nextCheckAt: true,
      ret1d: true,
      ret3d: true,
      ret7d: true,
      peakMultiple: true,
      hoursToPeak: true,
      drawdownAfterPeak: true,
      safetyStatus: true,
      flagSell: true,
      flagOwner: true,
      flagLiquidity: true,
      safetyNotes: true,
      entryChange24h: true,
    },
  });

  const done = tokens.filter((t) => t.status === "DONE");
  const doneCloses = done.length
    ? await db().token.findMany({ where: { status: "DONE" }, select: { id: true, entryPrice: true, closes: true } })
    : [];

  const simById = new Map<string, number>();
  for (const t of doneCloses) {
    const closes = Array.isArray(t.closes) ? (t.closes as number[]) : [];
    if (closes.length < TRACKING.horizonHours) continue;
    const r = simulate(t.entryPrice, closes, rules);
    if (r !== null) simById.set(t.id, r);
  }

  const vals = (list: typeof tokens, key: "ret1d" | "ret3d" | "ret7d") =>
    list.map((t) => t[key]).filter((v): v is number => v !== null);

  const reached2x = done.filter((t) => (t.peakMultiple ?? 0) >= 2);
  const multiDay = reached2x.filter((t) => (t.hoursToPeak ?? 0) > 24);
  const simReturns = [...simById.values()];

  const simMeanOf = (list: typeof tokens) => {
    const sims = list.map((t) => simById.get(t.id)).filter((v): v is number => v !== undefined);
    return sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : null;
  };

  // Flags overlap: a coin with two red flags appears in both rows.
  const scanned = tokens.filter((t) => t.safetyStatus === "SCANNED");
  const group = (key: string, label: string, list: typeof tokens): Group => ({
    key,
    label,
    n: list.length,
    median1d: median(vals(list, "ret1d")),
    median3d: median(vals(list, "ret3d")),
    median7d: median(vals(list, "ret7d")),
    simMean: simMeanOf(list),
  });

  const safetyGroups = [
    group("clean", "No red flags", scanned.filter((t) => !t.flagSell && !t.flagOwner && !t.flagLiquidity)),
    group("sell", "Sell risk", scanned.filter((t) => t.flagSell)),
    group("owner", "Dev controls", scanned.filter((t) => t.flagOwner)),
    group("liquidity", "Unlocked liquidity", scanned.filter((t) => t.flagLiquidity)),
    group("unscanned", "Not scanned", tokens.filter((t) => t.safetyStatus === "UNSCANNED")),
  ];

  // How far each coin had already run in the 24h before it was logged.
  const bucketOf = (change: number | null) =>
    change === null ? "unknown" : RUN_UP_BUCKETS.find((b) => change < b.max)?.key ?? "unknown";
  const runUpGroups = [
    ...RUN_UP_BUCKETS.map((b) => group(b.key, b.label, tokens.filter((t) => bucketOf(t.entryChange24h) === b.key))),
    group("unknown", "Not recorded", tokens.filter((t) => t.entryChange24h === null)),
  ];

  // Head-to-head at the longest horizon where both sides have at least 10 coins.
  const clean = scanned.filter((t) => !t.flagSell && !t.flagOwner && !t.flagLiquidity);
  const flagged = scanned.filter((t) => t.flagSell || t.flagOwner || t.flagLiquidity);
  const horizons = [
    ["a week", "ret7d"],
    ["three days", "ret3d"],
    ["a day", "ret1d"],
  ] as const;
  const safetyCompare =
    horizons
      .map(([label, key]) => ({
        label,
        clean: vals(clean, key),
        flagged: vals(flagged, key),
      }))
      .filter((h) => h.clean.length >= 10 && h.flagged.length >= 10)
      .map((h) => ({
        label: h.label,
        cleanN: h.clean.length,
        cleanMedian: median(h.clean),
        flaggedN: h.flagged.length,
        flaggedMedian: median(h.flagged),
      }))[0] ?? null;

  const byChain = NETWORKS.map(({ id, label }) => {
    const list = tokens.filter((t) => t.network === id);
    const finished = list.filter((t) => t.status === "DONE");
    return {
      id,
      label,
      logged: list.length,
      week: summarize(vals(finished, "ret7d")),
      simMean: simMeanOf(finished),
    };
  });

  return {
    total: tokens.length,
    failed: tokens.filter((t) => t.status === "FAILED").length,
    firstEntryAt: tokens.at(-1)?.entryAt ?? null,
    nextResultAt: tokens.filter((t) => t.status === "TRACKING").map((t) => t.nextCheckAt).sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
    checkpoints: {
      day1: summarize(vals(tokens, "ret1d")),
      day3: summarize(vals(tokens, "ret3d")),
      day7: summarize(vals(tokens, "ret7d")),
    },
    peaks: {
      n: done.length,
      reached2xPct: share(done.map((t) => t.peakMultiple ?? 0), (v) => v >= 2),
      multiDayPct: done.length ? multiDay.length / done.length : null,
      medianGiveBack: median(reached2x.map((t) => t.drawdownAfterPeak ?? 0)),
    },
    sim: {
      n: simReturns.length,
      mean: simReturns.length ? simReturns.reduce((a, b) => a + b, 0) / simReturns.length : null,
      median: median(simReturns),
      winPct: share(simReturns, (v) => v > 0),
    },
    byChain,
    safetyGroups,
    safetyCompare,
    runUpGroups,
    recent: tokens.slice(0, 40),
  };
}

export type Group = {
  key: string;
  label: string;
  n: number;
  median1d: number | null;
  median3d: number | null;
  median7d: number | null;
  simMean: number | null;
};

export type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;
