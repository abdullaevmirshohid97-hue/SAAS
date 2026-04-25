export function formatUZS(amount: number, locale = 'uz-UZ'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'UZS', maximumFractionDigits: 0 }).format(amount);
}

export function formatUSD(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function parseUZSInput(input: string): number {
  return Number(input.replace(/\D/g, ''));
}
