import { allowPageRequest } from "@/lib/arcjet";
import { loadDashboard, parseRules } from "@/lib/stats";
import { DashboardView } from "@/components/dashboard";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Home({ searchParams }: PageProps) {
  if (!(await allowPageRequest())) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <p>This request was blocked. If that&apos;s you, wait a minute and reload.</p>
      </main>
    );
  }

  const rules = parseRules(await searchParams);
  const data = await loadDashboard(rules);
  return <DashboardView data={data} rules={rules} />;
}
