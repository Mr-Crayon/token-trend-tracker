# Trend tracker

A two-week test of one question: do meme coins that start trending keep running for days?

Every hour it logs coins the first time they appear on GeckoTerminal's trending lists for the chains fomo trades on (Solana, Base, BNB Chain, Ethereum, Monad, Robinhood Chain). Right after logging, it takes a contract safety snapshot. It then pulls each coin's hourly price history at 24 hours, 3 days, and 7 days after it was logged. The dashboard shows how many were still up at each point, how many ran past 2x after their first day, whether coins with red flags did worse, and what a set of exit rules would have returned.

Stack: Next.js 16, TypeScript, Tailwind v4, shadcn/ui, Prisma 7 (Neon adapter), Arcjet.

## Setup

1. **Keys.** Get a free CoinGecko Demo API key (10k calls/month, which covers the test) and an Arcjet key.
2. **Repo and Vercel.** Push this folder to a new GitHub repo, import it into Vercel, then add Neon from the project's Storage tab. That sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
3. **Env vars in Vercel.** Add `COINGECKO_DEMO_API_KEY`, `CRON_SECRET`, and `ARCJET_KEY`, then redeploy.
4. **Database.** Locally, copy `.env.example` to `.env`, fill in the Neon URLs, then:
   ```bash
   npm install
   npm run db:push
   ```
5. **Scheduler.** In the GitHub repo, add secrets `TRACKER_URL` (your Vercel URL) and `CRON_SECRET` (same value as in Vercel). Open the Actions tab, pick "tracker", and click "Run workflow" once to check it. After that it runs every hour at :07.

A successful run returns JSON like:
```json
{ "discovery": { "added": ["TOAD (base)"], "networks": { "solana": "20 trending, 3 new", ... } }, "evaluation": { "evaluated": 4, ... } }
```

## Tuning

Everything adjustable is in `src/lib/config.ts`: chains, how many new coins to log per run, liquidity and pool-age filters, checkpoints, and the default exit rules. The dashboard's exit-rule form also takes URL params: `/?sell=50&tp=2&trail=30`.

API budget at the defaults: about 6 calls per run to check trending lists, plus up to 3 per coin over its week. With 6 new coins per hourly run that's roughly 8k calls over two weeks, inside the Demo plan's 10k/month. If you raise `maxNewPerRun` or run more often, check your usage in the CoinGecko dashboard.

## How the numbers work

- **Entry** is the price when a coin was logged. Runs are hourly, so entries land up to an hour after a coin started trending, and GeckoTerminal's list is a stand-in for fomo's feed, not the same thing.
- **Returns** use hourly closing prices, forward-filled through hours with no trades. Closes ignore brief wicks, so a coin that spiked and fell back within one hour doesn't count as a peak.
- **The exit-rule simulator** buys every finished coin at entry, sells part at your target, and sells the rest when a close falls your trailing percentage below the best close so far. It charges 0.5% per side (fomo's spot fee) and assumes no slippage, so real results during a dump would be worse.
- **Failed coins** (five straight fetch errors) are left out of the stats and counted in the footer. Many are probably dead, so a large number there means the results look better than they were.

## Safety snapshot

Within 3 hours of logging a coin, the tracker checks its contract and records three red flags. It records them without filtering anything out, so the dashboard can compare flagged coins against clean ones.

- **Sell risk:** honeypot, can't sell the full balance, or a sell tax of 10% or more.
- **Dev controls:** the creator can still mint, freeze, change taxes, blacklist or whitelist wallets, pause trading, or upgrade the contract. On EVM chains, owner-only powers are ignored when ownership is renounced.
- **Unlocked liquidity:** under 90% of the LP is locked or burned. Coins still on a launchpad bonding curve count as locked, since the curve program holds the liquidity.

Sources: GoPlus for Base, BNB Chain, and Ethereum (batched per chain, no key needed) and Rugcheck for Solana (one call per coin). Monad and Robinhood Chain have no free scanner, so their coins are marked "not scanned." Thresholds, the launchpad dex list, and the scan window are in `SAFETY` in `src/lib/config.ts`. Each coin's detailed findings are in `safetyNotes` (hover the chain line in the latest-coins table), and the scanner's raw response is saved in `safetyRaw`.

Two cautions. Scans are a snapshot: a clean result means little if the owner can still change taxes or blacklists, which is why those powers count as flags. And Solana flags come from matching Rugcheck's risk names; if Rugcheck renames a risk, check the regexes at the top of the Rugcheck section in `src/lib/safety.ts`.

## Known gaps

- Monad's GeckoTerminal network id (`monad`) wasn't verified. If it's wrong, that chain shows an error in the run output and the others keep working. Fix it in `NETWORKS` in `src/lib/config.ts`.
- fomo also added Arc recently. Add it to `NETWORKS` once you know its GeckoTerminal id.
- The dashboard is public but has no private data. Arcjet blocks bots and rate-limits it. Add auth if you want it hidden.
