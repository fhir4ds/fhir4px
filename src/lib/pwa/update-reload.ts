/**
 * Whether a page may reload itself now that a new version has taken over.
 *
 * The reload is the price of an automatic update, so it is only paid when it
 * cannot disturb anything: not on the visit that installed the worker (that
 * page is already current), not on the SMART callback page (an OAuth code
 * exchange is in flight), and not while a job holds the update.
 */

export interface UpdateSituation {
  /** The page loaded with a worker already in control: a previous version. */
  hadController: boolean;
  /** The URL is the SMART callback page. */
  smartCallback: boolean;
  /** Something holds the update (an export, a long job). */
  held: boolean;
}

export function updateReloadAllowed(situation: UpdateSituation): boolean {
  return situation.hadController && !situation.smartCallback && !situation.held;
}

/**
 * The visit that installs the worker reads a document without the isolation
 * headers, so the analysis engine has no SharedArrayBuffer until the page is
 * reloaded through the worker. Reload once for that, never on the callback
 * page and never twice in a tab.
 */
export function needsIsolationReload(situation: {
  hadController: boolean;
  isolated: boolean;
  smartCallback: boolean;
  alreadyReloaded: boolean;
}): boolean {
  return !situation.hadController && !situation.isolated && !situation.smartCallback && !situation.alreadyReloaded;
}
