export function formatUsd(usd: number | undefined): string {
  if (usd === undefined) return 'n/a';

  const magnitude = Math.abs(usd);
  if (magnitude === 0 || magnitude >= 0.01) return `$${usd.toFixed(2)}`;

  // Prompt and individual-call estimates are commonly below one cent. Keep
  // enough decimal places to avoid presenting real spend as "$0.00" while
  // retaining the familiar two-decimal display for normal dollar amounts.
  const decimals = Math.min(6, Math.max(3, Math.ceil(-Math.log10(magnitude)) + 1));
  if (Number(usd.toFixed(decimals)) !== 0) return `$${usd.toFixed(decimals)}`;
  return usd > 0 ? '<$0.000001' : '>-$0.000001';
}
