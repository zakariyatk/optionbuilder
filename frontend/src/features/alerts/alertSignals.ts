import type { PriceAlert } from '../../store/alerts';

/**
 * How a fired alert gets your attention: a chime (Web Audio, no sound file)
 * and a system notification when the browser allows one. Browsers only let a
 * page make sound or ask for notifications after a click, so `armAlertSound`
 * runs when an alert is created.
 */

let audio: AudioContext | null = null;

/** Call from a user action (adding an alert): unlocks sound and asks for notifications once. */
export function armAlertSound() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
  if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
}

/** Three rising beeps. Silent if the browser never unlocked audio. */
export function ringAlert() {
  if (!audio) {
    try {
      audio = new AudioContext();
    } catch {
      return;
    }
  }
  const ctx = audio;
  if (ctx.state === 'suspended') void ctx.resume();
  const start = ctx.currentTime + 0.02;
  [880, 1046.5, 1318.5].forEach((freq, i) => {
    const t = start + i * 0.22;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  });
}

const fmt = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const alertTitle = (a: PriceAlert) => `${a.symbol} Crossing ${fmt(a.price)}`;
export const alertDetail = (a: PriceAlert) =>
  a.triggerPrice !== null ? `Price ${fmt(a.triggerPrice)} at ${new Date(a.triggeredAt ?? Date.now()).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}` : '';

/** Sound plus a system notification for alerts that just fired. */
export function signalAlerts(fired: PriceAlert[]) {
  if (fired.length === 0) return;
  ringAlert();
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  for (const a of fired) {
    try {
      new Notification(alertTitle(a), { body: alertDetail(a), tag: a.id });
    } catch {
      /* some mobile browsers only allow notifications from a service worker; the in-app popup still shows */
    }
  }
}
