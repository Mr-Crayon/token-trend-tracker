import { db } from "@/lib/db";
import { SAFETY, networkScanner } from "@/lib/config";
import { readLiquidity } from "@/lib/liquidity";

/**
 * Contract safety snapshot, taken shortly after a coin is logged.
 *
 * Three red flags:
 * - sell:      can't sell (honeypot, sell blocked, transfer restrictions) or sell tax >= SAFETY.maxSellTax
 * - owner:     the dev keeps powers over the token: mint, freeze, change taxes, blacklist/whitelist, pause, upgrade
 * - liquidity: less than SAFETY.minLockedLp of the LP is locked or burned (see readLiquidity)
 *
 * A flag is null when the scanner couldn't tell.
 */
export type Assessment = {
  flagSell: boolean | null;
  flagOwner: boolean | null;
  flagLiquidity: boolean | null;
  sellTax: number | null;
  lpLockedPct: number | null;
  notes: string[];
};

// ---------- HTTP ----------

const lastCall = new Map<string, number>();

async function getJson<T>(url: string): Promise<T> {
  const host = new URL(url).host;
  const wait = (lastCall.get(host) ?? 0) + 1_100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall.set(host, Date.now());

  const res = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`${host} ${res.status}`);
  return (await res.json()) as T;
}

// ---------- GoPlus (EVM) ----------

type GoPlusLpHolder = { address?: string; is_locked?: number | string; percent?: string; tag?: string };
export type GoPlusToken = Record<string, unknown> & { lp_holders?: GoPlusLpHolder[]; owner_address?: string };
type GoPlusResponse = { code?: number; message?: string; result?: Record<string, GoPlusToken> };

const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

async function goPlusBatch(chainId: string, addresses: string[]): Promise<Record<string, GoPlusToken>> {
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${addresses.join(",")}`;
  const body = await getJson<GoPlusResponse>(url);
  // 1 = OK, 2 = partial data. Anything else is an error (including rate limits).
  if (body.code !== 1 && body.code !== 2) throw new Error(`GoPlus: ${body.message ?? `code ${body.code}`}`);
  const out: Record<string, GoPlusToken> = {};
  for (const [addr, data] of Object.entries(body.result ?? {})) out[addr.toLowerCase()] = data;
  return out;
}

function yes(value: unknown): boolean {
  return value === "1" || value === 1;
}

function fraction(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function assessGoPlus(t: GoPlusToken, dex: string | null): Assessment {
  const notes: string[] = [];

  // Can I sell?
  const sellTax = fraction(t.sell_tax);
  const sellNotes: string[] = [];
  if (yes(t.is_honeypot)) sellNotes.push("Honeypot");
  if (yes(t.cannot_sell_all)) sellNotes.push("Can't sell full balance");
  if (sellTax !== null && sellTax >= SAFETY.maxSellTax) sellNotes.push(`Sell tax ${Math.round(sellTax * 100)}%`);
  notes.push(...sellNotes);
  const sellKnown = t.is_honeypot !== undefined || sellTax !== null;

  // What can the dev still do?
  const owner = String(t.owner_address ?? "").toLowerCase();
  const ownerless =
    (owner === "" || BURN_ADDRESSES.has(owner)) && !yes(t.hidden_owner) && !yes(t.can_take_back_ownership);
  const ownerNotes: string[] = [];
  if (t.is_open_source === "0") ownerNotes.push("Closed-source contract");
  if (yes(t.is_proxy)) ownerNotes.push("Upgradeable proxy");
  if (yes(t.owner_change_balance)) ownerNotes.push("Owner can change balances");
  if (yes(t.hidden_owner)) ownerNotes.push("Hidden owner");
  if (yes(t.can_take_back_ownership)) ownerNotes.push("Ownership can be reclaimed");
  if (yes(t.selfdestruct)) ownerNotes.push("Can self-destruct");
  // These only matter while someone holds the owner role.
  if (!ownerless) {
    if (yes(t.is_mintable)) ownerNotes.push("Owner can mint");
    if (yes(t.slippage_modifiable) || yes(t.personal_slippage_modifiable)) ownerNotes.push("Owner can change taxes");
    if (yes(t.transfer_pausable)) ownerNotes.push("Trading can be paused");
    if (yes(t.is_blacklisted)) ownerNotes.push("Blacklist");
    if (yes(t.is_whitelisted)) ownerNotes.push("Whitelist");
  }
  notes.push(...ownerNotes);
  const ownerKnown = t.is_open_source !== undefined;

  // Is the liquidity locked? Store the raw share; readLiquidity decides what it means.
  let lpLockedPct: number | null = null;
  if (Array.isArray(t.lp_holders) && t.lp_holders.length > 0) {
    const locked = t.lp_holders.reduce((sum, h) => {
      const burned = BURN_ADDRESSES.has(String(h.address ?? "").toLowerCase());
      return burned || yes(h.is_locked) ? sum + (fraction(h.percent) ?? 0) : sum;
    }, 0);
    lpLockedPct = Math.min(1, locked);
  }
  const liquidity = readLiquidity(dex, lpLockedPct);
  if (liquidity.note) notes.push(liquidity.note);

  return {
    flagSell: sellKnown ? sellNotes.length > 0 : null,
    flagOwner: ownerKnown ? ownerNotes.length > 0 : null,
    flagLiquidity: liquidity.flag,
    sellTax,
    lpLockedPct,
    notes,
  };
}

// ---------- Rugcheck (Solana) ----------

export type RugcheckSummary = {
  score?: number;
  score_normalised?: number;
  lpLockedPct?: number | null;
  tokenProgram?: string;
  risks?: Array<{ name?: string; value?: string; description?: string; level?: string; score?: number }>;
};

const SOLANA_OWNER_RISK = /mint authority|freeze authority|permanent (delegate|control)|close authority|balance mutable|mutable balance/i;
const SOLANA_SELL_RISK = /transfer fee|transfer hook|non[- ]?transferable|default account state|honeypot/i;

export function assessRugcheck(summary: RugcheckSummary, dex: string | null): Assessment {
  const risks = (summary.risks ?? []).map((r) => r.name ?? "").filter(Boolean);
  const sellNotes = risks.filter((r) => SOLANA_SELL_RISK.test(r));
  const ownerNotes = risks.filter((r) => SOLANA_OWNER_RISK.test(r));
  const notes = [...sellNotes, ...ownerNotes];

  const lpLockedPct =
    typeof summary.lpLockedPct === "number" && Number.isFinite(summary.lpLockedPct)
      ? Math.min(1, Math.max(0, summary.lpLockedPct / 100))
      : null;
  const liquidity = readLiquidity(dex, lpLockedPct);
  if (liquidity.note) notes.push(liquidity.note);

  return {
    flagSell: sellNotes.length > 0,
    flagOwner: ownerNotes.length > 0,
    flagLiquidity: liquidity.flag,
    sellTax: null,
    lpLockedPct,
    notes,
  };
}

// ---------- Scan step ----------

export type ScanResult = { scanned: number; unscanned: number; errors: string[] };

/** Scan coins logged in the last few hours that haven't been checked yet. */
export async function scanPending(deadline: number): Promise<ScanResult> {
  const result: ScanResult = { scanned: 0, unscanned: 0, errors: [] };
  const cutoff = new Date(Date.now() - SAFETY.maxScanDelayHours * 3_600_000);

  // Too late to count as an entry-time snapshot.
  const expired = await db().token.updateMany({
    where: { safetyStatus: "PENDING", entryAt: { lt: cutoff } },
    data: { safetyStatus: "UNSCANNED", safetyNotes: [`Not scanned within ${SAFETY.maxScanDelayHours}h of logging`] },
  });
  result.unscanned += expired.count;

  const pending = await db().token.findMany({
    where: { safetyStatus: "PENDING" },
    orderBy: { entryAt: "asc" },
    take: 30,
    select: { id: true, network: true, tokenAddress: true, dex: true },
  });

  const save = async (id: string, source: string, a: Assessment, raw: unknown) => {
    await db().token.update({
      where: { id },
      data: {
        safetyStatus: "SCANNED",
        safetySource: source,
        scannedAt: new Date(),
        flagSell: a.flagSell,
        flagOwner: a.flagOwner,
        flagLiquidity: a.flagLiquidity,
        sellTax: a.sellTax,
        lpLockedPct: a.lpLockedPct,
        safetyNotes: a.notes,
        safetyRaw: raw as object,
      },
    });
    result.scanned++;
  };

  // EVM: GoPlus answers a batch per chain.
  const byChain = new Map<string, typeof pending>();
  for (const t of pending) {
    const scanner = networkScanner(t.network);
    if (scanner?.kind !== "goplus") continue;
    byChain.set(scanner.chainId, [...(byChain.get(scanner.chainId) ?? []), t]);
  }
  for (const [chainId, tokens] of byChain) {
    if (Date.now() > deadline) break;
    try {
      const data = await goPlusBatch(chainId, tokens.map((t) => t.tokenAddress));
      for (const t of tokens) {
        const entry = data[t.tokenAddress.toLowerCase()];
        // Brand-new tokens sometimes aren't indexed yet; stay PENDING and retry next run.
        if (!entry || Object.keys(entry).length === 0) continue;
        // Holder and DEX lists are large and not needed later.
        const trimmed = { ...entry };
        delete trimmed.holders;
        delete trimmed.dex;
        await save(t.id, "goplus", assessGoPlus(entry, t.dex), trimmed);
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : `GoPlus chain ${chainId} failed`);
    }
  }

  // Solana: Rugcheck answers one mint per request.
  for (const t of pending.filter((p) => networkScanner(p.network)?.kind === "rugcheck")) {
    if (Date.now() > deadline) break;
    try {
      const summary = await getJson<RugcheckSummary>(
        `https://api.rugcheck.xyz/v1/tokens/${t.tokenAddress}/report/summary`,
      );
      await save(t.id, "rugcheck", assessRugcheck(summary, t.dex), summary);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "Rugcheck failed");
    }
  }

  return result;
}
