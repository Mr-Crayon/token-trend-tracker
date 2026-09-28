import { db } from "@/lib/db";
import { DISCOVERY, NETWORKS, TRACKING, networkScanner } from "@/lib/config";
import { RateLimitError, trendingPools, type TrendingPool } from "@/lib/gecko";
import { checkpointDueAt } from "@/lib/metrics";

type Candidate = TrendingPool & { network: string };

export type DiscoveryResult = {
  added: string[];
  networks: Record<string, string>;
  rateLimited: boolean;
};

function passesFilters(pool: TrendingPool, now: Date): boolean {
  if (!pool.priceUsd || pool.priceUsd <= 0) return false;
  if ((pool.liquidityUsd ?? 0) < DISCOVERY.minLiquidityUsd) return false;
  if ((DISCOVERY.skipSymbols as readonly string[]).includes(pool.symbol.toUpperCase())) return false;
  if (pool.poolCreatedAt) {
    const ageDays = (now.getTime() - pool.poolCreatedAt.getTime()) / 86_400_000;
    if (ageDays > DISCOVERY.maxPoolAgeDays) return false;
  }
  return true;
}

/** Log coins the first time they appear on a trending list. */
export async function discover(deadline: number): Promise<DiscoveryResult> {
  const now = new Date();
  const result: DiscoveryResult = { added: [], networks: {}, rateLimited: false };
  const perNetwork: Candidate[][] = [];

  for (const { id } of NETWORKS) {
    if (Date.now() > deadline) {
      result.networks[id] = "skipped: out of time";
      continue;
    }
    try {
      const pools = await trendingPools(id);
      const seen = new Set<string>();
      const fresh = pools
        .slice(0, DISCOVERY.topPerNetwork)
        .filter((p) => passesFilters(p, now))
        .filter((p) => !seen.has(p.tokenAddress) && seen.add(p.tokenAddress));

      const existing = await db().token.findMany({
        where: { network: id, tokenAddress: { in: fresh.map((p) => p.tokenAddress) } },
        select: { tokenAddress: true },
      });
      const known = new Set(existing.map((t) => t.tokenAddress));
      const unseen = fresh.filter((p) => !known.has(p.tokenAddress)).map((p) => ({ ...p, network: id }));

      perNetwork.push(unseen);
      result.networks[id] = `${pools.length} trending, ${unseen.length} new`;
    } catch (error) {
      if (error instanceof RateLimitError) {
        result.rateLimited = true;
        result.networks[id] = "rate limited";
        break;
      }
      result.networks[id] = error instanceof Error ? error.message : "failed";
    }
  }

  // Take new coins round-robin by rank so one busy chain can't crowd out the rest.
  const picked: Candidate[] = [];
  for (let rank = 0; picked.length < DISCOVERY.maxNewPerRun; rank++) {
    const row = perNetwork.map((list) => list[rank]).filter(Boolean);
    if (row.length === 0) break;
    picked.push(...row.slice(0, DISCOVERY.maxNewPerRun - picked.length));
  }

  if (picked.length > 0) {
    await db().token.createMany({
      skipDuplicates: true,
      data: picked.map((p) => ({
        network: p.network,
        tokenAddress: p.tokenAddress,
        poolAddress: p.poolAddress,
        symbol: p.symbol.slice(0, 40),
        name: p.name.slice(0, 120),
        dex: p.dex,
        trendRank: p.rank,
        poolCreatedAt: p.poolCreatedAt,
        entryAt: now,
        entryPrice: p.priceUsd!,
        entryFdv: p.fdvUsd,
        entryLiquidity: p.liquidityUsd,
        entryVolume24h: p.volume24hUsd,
        nextCheckAt: checkpointDueAt(now, TRACKING.checkpointsHours[0], TRACKING.settleMinutes),
        ...(networkScanner(p.network)
          ? {}
          : { safetyStatus: "UNSCANNED" as const, safetyNotes: ["No free scanner for this chain"] }),
      })),
    });
    result.added = picked.map((p) => `${p.symbol} (${p.network})`);
  }

  return result;
}
