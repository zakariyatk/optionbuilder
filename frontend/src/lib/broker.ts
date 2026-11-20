/**
 * The broker the backend is set up with ('Upstox' or 'Zerodha'), for labels.
 * Set from /api/auth/status as soon as it loads; every page renders after that
 * status arrives, so a plain module value is enough.
 */
let name = 'broker';

export function setBrokerName(next: string | undefined): void {
  if (next) name = next;
}

export function brokerName(): string {
  return name;
}
