/** Positive integer from `process.env[name]`; `fallback` when unset, non-numeric or ≤ 0. */
export function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
}
