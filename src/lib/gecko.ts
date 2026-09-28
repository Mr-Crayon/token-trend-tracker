import { API, DISCOVERY } from "@/lib/config";

/** CoinGecko's onchain API (GeckoTerminal data) on the free Demo plan. */
const BASE_URL = "https://api.coingecko.com/api/v3/onchain";

export class RateLimitError extends Error {
  constructor() {
    super("CoinGecko rate limit hit (429)");
  }
}

export class GeckoHttpError extends Error {
  constructor(
    public status: number,
    path: string,
  ) {
    super(`CoinGecko ${status} for ${path}`);
  }
}

let lastCallAt = 0;

async function throttle() {
  const wait = lastCallAt + API.minSpacingMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const key = process.env.COINGECKO_DEMO_API_KEY;
  if (!key) throw new Error("COINGECKO_DEMO_API_KEY is not set");

  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  await throttle();
  const res = await fetch(url, {
    headers: { accept: "application/json", "x-cg-demo-api-key": key },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 429) throw new RateLimitError();
  if (!res.ok) throw new GeckoHttpError(res.status, path);
  return (await res.json()) as T;
}

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

// ---------- Trending pools ----------

export type TrendingPool = {
  rank: number;
  poolAddress: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  dex: string | null;
  priceUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  poolCreatedAt: Date | null;
};

type JsonApiRef = { data?: { id?: string } | null };
type TrendingResponse = {
  data?: Array<{
    attributes?: {
      address?: string;
      name?: string;
      base_token_price_usd?: string;
      fdv_usd?: string | null;
      reserve_in_usd?: string | null;
      volume_usd?: { h24?: string | null };
      pool_created_at?: string | null;
    };
    relationships?: { base_token?: JsonApiRef; dex?: JsonApiRef };
  }>;
  included?: Array<{
    id?: string;
    type?: string;
    attributes?: { address?: string; name?: string; symbol?: string };
  }>;
};

export async function trendingPools(network: string): Promise<TrendingPool[]> {
  const body = await get<TrendingResponse>(`/networks/${network}/trending_pools`, {
    include: "base_token",
    duration: DISCOVERY.trendingDuration,
    page: 1,
  });

  const tokens = new Map((body.included ?? []).filter((i) => i.type === "token").map((i) => [i.id, i.attributes]));

  const pools: TrendingPool[] = [];
  (body.data ?? []).forEach((pool, index) => {
    const a = pool.attributes;
    const baseRef = pool.relationships?.base_token?.data?.id;
    const base = baseRef ? tokens.get(baseRef) : undefined;
    // Relationship ids look like "solana_<address>"; prefer the included token's own address.
    const tokenAddress = base?.address ?? baseRef?.slice(network.length + 1);
    if (!a?.address || !tokenAddress) return;

    const createdAt = a.pool_created_at ? new Date(a.pool_created_at) : null;
    pools.push({
      rank: index + 1,
      poolAddress: a.address,
      tokenAddress,
      symbol: base?.symbol ?? a.name?.split(" / ")[0] ?? "?",
      name: base?.name ?? a.name ?? "",
      dex: pool.relationships?.dex?.data?.id ?? null,
      priceUsd: num(a.base_token_price_usd),
      fdvUsd: num(a.fdv_usd),
      liquidityUsd: num(a.reserve_in_usd),
      volume24hUsd: num(a.volume_usd?.h24),
      poolCreatedAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
    });
  });
  return pools;
}

// ---------- Hourly candles ----------

/** [unix seconds (candle start), open, high, low, close, volume] */
export type Candle = [number, number, number, number, number, number];

type OhlcvResponse = { data?: { attributes?: { ohlcv_list?: unknown[] } } };

export async function hourlyCandles(network: string, poolAddress: string, limit: number): Promise<Candle[]> {
  const body = await get<OhlcvResponse>(`/networks/${network}/pools/${poolAddress}/ohlcv/hour`, {
    aggregate: 1,
    limit: Math.min(1000, Math.max(2, Math.ceil(limit))),
    currency: "usd",
    token: "base",
  });

  const rows = body.data?.attributes?.ohlcv_list ?? [];
  const candles: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const values = row.slice(0, 6).map(num);
    if (values.some((v, i) => i < 5 && v === null)) continue;
    candles.push([values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5] ?? 0]);
  }
  return candles.sort((a, b) => a[0] - b[0]);
}
