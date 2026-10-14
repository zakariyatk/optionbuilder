/** Wall-clock IST for a moment, as a Date whose local fields read in IST. */
function istFields(now: Date): Date {
  return new Date(now.getTime() + (5.5 * 60 + now.getTimezoneOffset()) * 60_000);
}

/** NSE cash session: Mon–Fri, 09:15–15:30 IST (exchange holidays aside). */
export function nseOpen(now = new Date()): boolean {
  const ist = istFields(now);
  const day = ist.getDay();
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  return day >= 1 && day <= 5 && minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30;
}

/** Epoch ms of today's 15:30 IST close. */
export function nseCloseMs(now = new Date()): number {
  const ist = istFields(now);
  const minutesIntoDay = ist.getHours() * 60 + ist.getMinutes() + ist.getSeconds() / 60 + ist.getMilliseconds() / 60_000;
  return now.getTime() + (15 * 60 + 30 - minutesIntoDay) * 60_000;
}
