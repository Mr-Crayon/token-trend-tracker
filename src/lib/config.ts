/**
 * Everything you might want to tune lives here.
 */

export type Scanner = { kind: "rugcheck" } | { kind: "goplus"; chainId: string } | null;

/**
 * GeckoTerminal network ids for the chains fomo trades on, and which free
 * scanner checks their contracts. Monad and Robinhood Chain have none yet.
 */
export const NETWORKS = [
  { id: "solana", label: "Solana", scanner: { kind: "rugcheck" } },
  { id: "base", label: "Base", scanner: { kind: "goplus", chainId: "8453" } },
  { id: "bsc", label: "BNB Chain", scanner: { kind: "goplus", chainId: "56" } },
  { id: "eth", label: "Ethereum", scanner: { kind: "goplus", chainId: "1" } },
  { id: "monad", label: "Monad", scanner: null },
  { id: "robinhood", label: "Robinhood Chain", scanner: null },
] as const satisfies readonly { id: string; label: string; scanner: Scanner }[];

export type NetworkId = (typeof NETWORKS)[number]["id"];

export function networkLabel(id: string): string {
  return NETWORKS.find((n) => n.id === id)?.label ?? id;
}

export function networkScanner(id: string): Scanner {
  return NETWORKS.find((n) => n.id === id)?.scanner ?? null;
}

export const DISCOVERY = {
  /** Trending window GeckoTerminal ranks by: "5m" | "1h" | "6h" | "24h". */
  trendingDuration: "1h",
  /** Only look at the top N trending pools per chain. */
  topPerNetwork: 10,
  /** Cap on new coins logged per run, spread across chains by rank. Keeps API usage inside the free tier. */
  maxNewPerRun: 6,
  /** Skip pools thinner than this; they can't be exited anyway. */
  minLiquidityUsd: 10_000,
  /** Skip pools older than this, which filters out majors like SOL/USDC. */
  maxPoolAgeDays: 30,
  /** Base tokens that are never meme coins. */
  skipSymbols: [
    "SOL", "WSOL", "ETH", "WETH", "BNB", "WBNB", "MON", "WMON",
    "USDC", "USDT", "USDG", "USD1", "DAI", "WBTC", "CBBTC", "BTC",
  ],
} as const;

export const TRACKING = {
  /** How long each coin is followed after it's logged. */
  horizonHours: 168,
  /** When to pull fresh price history for each coin (hours after entry). */
  checkpointsHours: [24, 72, 168],
  /** Wait this long after a checkpoint before fetching, so the last hourly candle has closed. */
  settleMinutes: 10,
  /** Give up on a coin after this many consecutive fetch errors. */
  maxErrors: 5,
} as const;

export const API = {
  /** Spacing between CoinGecko calls. The Demo plan allows 30/min; this stays under it. */
  minSpacingMs: 2_200,
  /** Stop starting new work after this long so the function returns before its 60s limit. */
  runBudgetMs: 50_000,
} as const;

/**
 * Buckets for how far a coin had already run in the 24h before it was logged.
 * Upper bounds as fractions: 0.5 = +50%, 2 = +200%.
 */
export const RUN_UP_BUCKETS = [
  { key: "early", label: "Under +50%", max: 0.5 },
  { key: "mid", label: "+50% to +200%", max: 2 },
  { key: "late", label: "Over +200%", max: Infinity },
] as const;

/** Default exit rules for the simulator. Override with ?tp=&sell=&trail= on the dashboard. */
export const SIM_DEFAULTS = {
  takeProfitMultiple: 2,
  takeProfitFraction: 0.5,
  trailPct: 0.3,
  /** fomo charges 0.5% per spot trade on most chains. */
  feePct: 0.005,
} as const;

/** Contract safety snapshot taken when a coin is logged. */
export const SAFETY = {
  /** Sell tax at or above this counts as a sell risk. */
  maxSellTax: 0.1,
  /** Less than this share of LP locked or burned counts as unlocked liquidity. */
  minLockedLp: 0.9,
  /** Only scan within this many hours of logging, so the result reflects what you'd have seen at entry. */
  maxScanDelayHours: 3,
  /**
   * GeckoTerminal dex ids for bonding-curve launchpads, where the curve program
   * holds the liquidity and the dev can't pull it. Check the `dex` column in
   * Prisma Studio after a few days and adjust.
   */
  programHeldLiquidityDexes: ["pump-fun", "raydium-launchlab", "meteora-dbc", "four-meme"],
} as const;
