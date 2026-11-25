/**
 * Long jobs a version reload would destroy. The service worker's reload waits
 * while something holds the update, then happens as soon as the last hold is
 * released (see register-sw.ts).
 *
 * A hold is a function that releases it; releasing twice does nothing, so an
 * effect may hold in StrictMode without leaking.
 */

let holds = 0;

export function holdAppUpdate(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
  };
}

export function appUpdateHeld(): boolean {
  return holds > 0;
}
