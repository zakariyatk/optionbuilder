/**
 * Which broker serves the account side (margin): 'Zerodha' when the server has
 * Kite keys, else 'Upstox'. Market data always comes from Upstox. Set from
 * /api/auth/status as soon as it loads; pages render after that status
 * arrives, so a plain module value is enough.
 */
let name = 'Upstox';

export function setMarginBrokerName(next: string): void {
  name = next;
}

export function marginBrokerName(): string {
  return name;
}
