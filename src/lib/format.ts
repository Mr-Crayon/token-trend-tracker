/** "+12%" / "−34%" with a real minus sign. */
export function signedPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "—";
  const pct = (value * 100).toFixed(digits);
  if (Number(pct) === 0) return "0%";
  return value > 0 ? `+${pct}%` : `−${pct.replace("-", "")}%`;
}

export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

export function multiple(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}x`;
}

export function dollars(value: number): string {
  const abs = Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return value < 0 ? `−$${abs}` : `+$${abs}`;
}

/** "in 5h", "3d ago". */
export function relative(date: Date): string {
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const hours = abs / 3_600_000;
  const span =
    hours < 1 ? `${Math.max(1, Math.round(abs / 60_000))}m` : hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
  return diff >= 0 ? `in ${span}` : `${span} ago`;
}

export function toneClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-up" : "text-down";
}
