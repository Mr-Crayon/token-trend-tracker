import { SAFETY } from "@/lib/config";

export type LiquidityRead = { flag: boolean | null; note: string | null };

/**
 * Whether a pool's liquidity counts as unlocked; null means the scanners can't tell.
 * Runs at scan time and again when the dashboard loads, so config changes apply to
 * coins already logged.
 */
export function readLiquidity(dex: string | null, lpLockedPct: number | null): LiquidityRead {
  if (dex && (SAFETY.programHeldLiquidityDexes as readonly string[]).includes(dex)) {
    return { flag: false, note: "Liquidity held by launchpad curve" };
  }
  if (dex && SAFETY.concentratedLiquidityDex.test(dex)) {
    return { flag: null, note: "LP lock unknown (concentrated-liquidity pool)" };
  }
  if (lpLockedPct === null) return { flag: null, note: "LP lock unknown" };

  const flag = lpLockedPct < SAFETY.minLockedLp;
  return { flag, note: flag ? `Only ${Math.round(lpLockedPct * 100)}% of LP locked or burned` : null };
}
