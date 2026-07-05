export function formatUsd(usd: number | undefined): string {
  return usd === undefined ? 'n/a' : `$${usd.toFixed(2)}`;
}
