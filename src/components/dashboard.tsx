import Link from "next/link";
import { networkLabel, SIM_DEFAULTS } from "@/lib/config";
import { dollars, multiple, pct, relative, signedPct, toneClass } from "@/lib/format";
import type { Dashboard, Group, Summary } from "@/lib/stats";
import type { SimRules } from "@/lib/metrics";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function DashboardView({ data, rules }: { data: Dashboard; rules: SimRules }) {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-12 pb-20 sm:pt-20">
      <Verdict data={data} />

      {data.total > 0 && (
        <>
          <Section title="From the moment each coin trended">
            <CheckpointTable data={data} />
          </Section>

          <Section title="Did they run for days?">
            <PeakSummary data={data} />
          </Section>

          <Section title="Did the safety checks matter?">
            <SafetySection data={data} />
          </Section>

          <Section title="Did the run-up before trending matter?">
            <RunUpSection data={data} />
          </Section>

          <Section title="Test your exit rules">
            <Simulator data={data} rules={rules} />
          </Section>

          <Section title="By chain">
            <ChainTable data={data} />
          </Section>

          <Section title="Latest coins">
            <RecentTable data={data} />
          </Section>
        </>
      )}

      <footer className="text-muted-foreground mt-16 max-w-[65ch] space-y-2 text-sm leading-relaxed">
        <p>
          Coins come from GeckoTerminal&apos;s trending lists, checked hourly. That&apos;s a stand-in for fomo&apos;s
          feed, so entries land within about an hour of when a coin started trending there.
        </p>
        <p>
          Returns compare hourly closing prices to the price when a coin was logged. Closes ignore brief wicks, so a
          coin that spiked and fell back inside one hour won&apos;t count as a peak.
        </p>
        {data.failed > 0 && (
          <p>
            {data.failed} {data.failed === 1 ? "coin" : "coins"} couldn&apos;t be priced and{" "}
            {data.failed === 1 ? "is" : "are"} left out. Many of those are likely dead, so a large number here makes
            the results look better than they were.
          </p>
        )}
      </footer>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <h2 className="font-serif mb-4 text-xl font-semibold tracking-[-0.005em]">{title}</h2>
      {children}
    </section>
  );
}

function Verdict({ data }: { data: Dashboard }) {
  const { day1, day3, day7 } = data.checkpoints;
  const pick: [string, Summary] | null =
    day7.n >= 10 ? ["a week", day7] : day3.n >= 10 ? ["three days", day3] : day1.n > 0 ? ["a day", day1] : null;

  let lead: string;
  let detail: string | null = null;

  if (data.total === 0) {
    lead = "No coins logged yet.";
    detail =
      "Coins are logged the first time they trend. After the hourly job runs they'll show up here, and day-one results follow 24 hours later.";
  } else if (!pick) {
    lead = `${data.total} ${data.total === 1 ? "coin" : "coins"} logged so far.`;
    detail = data.nextResultAt ? `The first results land ${relative(data.nextResultAt)}.` : null;
  } else {
    const [label, s] = pick;
    const up = Math.round((s.upPct ?? 0) * s.n);
    lead = `Of ${s.n} coins that trended, ${up} (${pct(s.upPct)}) were above their entry price ${label} later.`;
    if (data.peaks.n >= 10) detail = `${pct(data.peaks.multiDayPct)} closed above 2x after their first day.`;
    else if (data.nextResultAt) detail = `Tracking ${data.total} coins. More results land ${relative(data.nextResultAt)}.`;
  }

  return (
    <header>
      <h1 className="font-serif max-w-[30ch] text-[2rem] leading-[1.15] font-medium tracking-[-0.015em] text-balance sm:text-[2.75rem]">
        {lead}
      </h1>
      {detail && <p className="text-muted-foreground mt-4 max-w-[55ch] text-lg leading-relaxed">{detail}</p>}
    </header>
  );
}

function Ret({ value }: { value: number | null | undefined }) {
  return <span className={toneClass(value)}>{signedPct(value)}</span>;
}

function CheckpointTable({ data }: { data: Dashboard }) {
  const rows: [string, Summary][] = [
    ["1 day", data.checkpoints.day1],
    ["3 days", data.checkpoints.day3],
    ["7 days", data.checkpoints.day7],
  ];
  return (
    <Table className="tabular-nums">
      <TableCaption className="sr-only">Returns at each checkpoint after a coin was logged</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>After</TableHead>
          <TableHead className="text-right">Coins</TableHead>
          <TableHead className="text-right">Up</TableHead>
          <TableHead className="text-right">Median</TableHead>
          <TableHead className="text-right">Doubled</TableHead>
          <TableHead className="text-right">Halved</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([label, s]) => (
          <TableRow key={label}>
            <TableCell>{label}</TableCell>
            <TableCell className="text-right">{s.n || "—"}</TableCell>
            <TableCell className="text-right">{pct(s.upPct)}</TableCell>
            <TableCell className="text-right">
              <Ret value={s.median} />
            </TableCell>
            <TableCell className="text-right">{pct(s.doubledPct)}</TableCell>
            <TableCell className="text-right">{pct(s.halvedPct)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PeakSummary({ data }: { data: Dashboard }) {
  const { peaks } = data;
  if (peaks.n === 0) {
    return (
      <p className="text-muted-foreground max-w-[65ch] leading-relaxed">
        This needs coins with a full week of data. The first ones finish 7 days after they were logged.
      </p>
    );
  }
  return (
    <p className="max-w-[65ch] leading-relaxed">
      Of {peaks.n} coins tracked for a full week, {pct(peaks.reached2xPct)} closed at 2x or more at some point and{" "}
      {pct(peaks.multiDayPct)} got there after their first day.
      {peaks.medianGiveBack !== null && (
        <> The ones that hit 2x typically fell {pct(peaks.medianGiveBack)} from their best close before the week ended.</>
      )}
    </p>
  );
}

function SafetySection({ data }: { data: Dashboard }) {
  const cmp = data.safetyCompare;
  return (
    <>
      {cmp && (
        <p className="mb-4 max-w-[65ch] leading-relaxed">
          After {cmp.label}, coins with no red flags had a median return of <Ret value={cmp.cleanMedian} /> (
          {cmp.cleanN} coins), against <Ret value={cmp.flaggedMedian} /> for coins with at least one ({cmp.flaggedN}{" "}
          coins).
        </p>
      )}
      <GroupTable
        groups={data.safetyGroups}
        firstHeader="At entry"
        caption="Median returns grouped by contract safety flags at entry"
      />
      <p className="text-muted-foreground mt-4 max-w-[65ch] text-sm leading-relaxed">
        Medians, except the exit-rules column, which is the simulator&apos;s average. A coin with several flags counts
        in each of those rows. Sell risk means a honeypot, a blocked sale, or a sell tax of 10% or more. Dev controls
        means the creator can still mint, freeze, change taxes, blacklist or whitelist wallets, pause trading, or
        upgrade the contract. Unlocked liquidity means under 90% of the pool&apos;s LP is locked or burned. Monad and
        Robinhood Chain coins aren&apos;t scanned.
      </p>
    </>
  );
}

function GroupTable({ groups, firstHeader, caption }: { groups: Group[]; firstHeader: string; caption: string }) {
  return (
    <Table className="tabular-nums">
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{firstHeader}</TableHead>
          <TableHead className="text-right">Coins</TableHead>
          <TableHead className="text-right">1d</TableHead>
          <TableHead className="text-right">3d</TableHead>
          <TableHead className="text-right">7d</TableHead>
          <TableHead className="text-right">Exit rules</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((g) => (
          <TableRow key={g.key}>
            <TableCell>{g.label}</TableCell>
            <TableCell className="text-right">{g.n}</TableCell>
            <TableCell className="text-right">
              <Ret value={g.median1d} />
            </TableCell>
            <TableCell className="text-right">
              <Ret value={g.median3d} />
            </TableCell>
            <TableCell className="text-right">
              <Ret value={g.median7d} />
            </TableCell>
            <TableCell className="text-right">
              <Ret value={g.simMean} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RunUpSection({ data }: { data: Dashboard }) {
  const groups = data.runUpGroups.filter((g) => g.key !== "unknown" || g.n > 0);
  return (
    <>
      <p className="mb-4 max-w-[65ch] leading-relaxed">
        Grouped by how much each coin&apos;s price had already risen in the 24 hours before it was logged. If the
        later rows do worse, trending coins that already ran hard are where early buyers sell.
      </p>
      <GroupTable groups={groups} firstHeader="Already up" caption="Median returns grouped by price run-up before entry" />
      <p className="text-muted-foreground mt-4 max-w-[65ch] text-sm leading-relaxed">
        Medians, except the exit-rules column, which is the simulator&apos;s average. For coins under a day old, the
        run-up is measured from launch. Coins logged before this was tracked show as not recorded.
      </p>
    </>
  );
}

function flagLabels(t: Dashboard["recent"][number]): string[] {
  if (t.safetyStatus !== "SCANNED") return [];
  return [
    t.flagSell && "sell risk",
    t.flagOwner && "dev controls",
    t.flagLiquidity && "unlocked LP",
  ].filter((v): v is string => Boolean(v));
}

function Simulator({ data, rules }: { data: Dashboard; rules: SimRules }) {
  const { sim } = data;
  const isDefault =
    rules.takeProfitMultiple === SIM_DEFAULTS.takeProfitMultiple &&
    rules.takeProfitFraction === SIM_DEFAULTS.takeProfitFraction &&
    rules.trailPct === SIM_DEFAULTS.trailPct;

  return (
    <Card className="gap-5 rounded-md py-5 shadow-none">
      <CardContent className="px-5">
        <form method="get" className="space-y-3 leading-loose">
          <p>
            Buy every coin when it&apos;s logged. Sell{" "}
            <NumberField name="sell" label="Percent to sell at target" value={Math.round(rules.takeProfitFraction * 100)} min={0} max={100} step={5} />
            % the first time it closes at{" "}
            <NumberField name="tp" label="Target multiple" value={rules.takeProfitMultiple} min={1.1} max={100} step={0.1} />
            x. Sell the rest once it closes{" "}
            <NumberField name="trail" label="Trailing stop percent" value={Math.round(rules.trailPct * 100)} min={5} max={95} step={5} />
            % below its best close.
          </p>
          <div className="flex items-center gap-3">
            <Button type="submit">Run simulation</Button>
            {!isDefault && (
              <Link href="/" className="text-muted-foreground text-sm underline underline-offset-4">
                Reset rules
              </Link>
            )}
          </div>
        </form>

        <div className="mt-5 border-t pt-4">
          {sim.n === 0 ? (
            <p className="text-muted-foreground">Results appear once coins have a full week of data.</p>
          ) : (
            <p className="leading-relaxed">
              Across {sim.n} trades: average <Ret value={sim.mean} /> per trade, median <Ret value={sim.median} />,
              and {pct(sim.winPct)} made money. At $100 a coin that&apos;s{" "}
              <span className={toneClass(sim.mean)}>{dollars((sim.mean ?? 0) * 100 * sim.n)}</span> total.
            </p>
          )}
          <p className="text-muted-foreground mt-2 text-sm">
            Uses hourly closes with a 0.5% fee each way and no slippage. Real exits during a dump fill worse than this.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function NumberField(props: { name: string; label: string; value: number; min: number; max: number; step: number }) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      name={props.name}
      aria-label={props.label}
      defaultValue={props.value}
      min={props.min}
      max={props.max}
      step={props.step}
      className="mx-1 inline-block h-8 w-[4.5rem] px-2 text-center tabular-nums"
    />
  );
}

function ChainTable({ data }: { data: Dashboard }) {
  return (
    <Table className="tabular-nums">
      <TableCaption className="sr-only">Results by chain</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Chain</TableHead>
          <TableHead className="text-right">Logged</TableHead>
          <TableHead className="text-right">Full week</TableHead>
          <TableHead className="text-right">Up at 7d</TableHead>
          <TableHead className="text-right">Median 7d</TableHead>
          <TableHead className="text-right">Exit rules</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.byChain.map((c) => (
          <TableRow key={c.id}>
            <TableCell>{c.label}</TableCell>
            <TableCell className="text-right">{c.logged}</TableCell>
            <TableCell className="text-right">{c.week.n}</TableCell>
            <TableCell className="text-right">{pct(c.week.upPct)}</TableCell>
            <TableCell className="text-right">
              <Ret value={c.week.median} />
            </TableCell>
            <TableCell className="text-right">
              <Ret value={c.simMean} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RecentTable({ data }: { data: Dashboard }) {
  return (
    <Table className="tabular-nums">
      <TableCaption className="sr-only">The 40 most recently logged coins</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Coin</TableHead>
          <TableHead>Logged</TableHead>
          <TableHead className="text-right">1d</TableHead>
          <TableHead className="text-right">3d</TableHead>
          <TableHead className="text-right">7d</TableHead>
          <TableHead className="text-right">Best close</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.recent.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="max-w-[11rem] min-w-[8.5rem]">
              <a
                href={`https://www.geckoterminal.com/${t.network}/pools/${t.poolAddress}`}
                target="_blank"
                rel="noreferrer"
                className="block truncate font-medium underline-offset-4 hover:underline"
              >
                {t.symbol}
              </a>
              <span className="block text-xs leading-snug whitespace-normal" title={t.safetyNotes.join(", ") || undefined}>
                <span className="text-muted-foreground">{networkLabel(t.network)}</span>
                {flagLabels(t).length > 0 && <span className="text-down">, {flagLabels(t).join(", ")}</span>}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">
              <span className="block">{relative(t.entryAt)}</span>
              {t.entryChange24h !== null && (
                <span className="block text-xs">{signedPct(t.entryChange24h)} before</span>
              )}
            </TableCell>
            {t.status === "FAILED" ? (
              <TableCell colSpan={4} className="text-muted-foreground text-right">
                No price data
              </TableCell>
            ) : (
              <>
                <TableCell className="text-right">
                  <Ret value={t.ret1d} />
                </TableCell>
                <TableCell className="text-right">
                  <Ret value={t.ret3d} />
                </TableCell>
                <TableCell className="text-right">
                  <Ret value={t.ret7d} />
                </TableCell>
                <TableCell className="text-right">{multiple(t.peakMultiple)}</TableCell>
              </>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
