/**
 * Role-based visibility filter.
 *
 * Enforced at the API/serialization boundary so that Standard clients never
 * receive admin-only state over the wire — this matters in multiplayer for
 * fairness and for keeping hidden simulator internals (e.g. `fairValue`,
 * `qualityScore`, other players' positions) from leaking.
 *
 * The visibility map in `tuning.json` declares per-role, per-dotted-path
 * whether a field is visible. A field with no entry defaults to HIDDEN
 * (deny-by-default — safer than leaking new fields when they are added).
 */

import type { Role, Tuning, VisibilityMap } from "./tuning.js";

export interface VisibilityContext {
  role: Role;
  /** Player id of the requester, used to distinguish "own" from "other" data. */
  playerId?: string;
}

/** Returns whether a given dotted field path is visible to the role. */
export function isVisible(tuning: Tuning, role: Role, fieldPath: string): boolean {
  const map: VisibilityMap | undefined = tuning.visibility.roles[role];
  if (!map) return false; // unknown role -> hide everything
  return map[fieldPath] === true;
}

/**
 * Filter a plain object by role using a `pathMap` describing which dotted
 * path each top-level key on the object corresponds to. Keys not present in
 * `pathMap` are passed through (they're considered "structural", not data).
 *
 * Returns a new object containing only the visible keys.
 */
export function filterObject<T extends Record<string, unknown>>(
  tuning: Tuning,
  role: Role,
  obj: T,
  pathMap: Record<keyof T & string, string>,
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T & string>) {
    const fieldPath = pathMap[key];
    if (fieldPath === undefined) {
      // Structural / always-visible
      out[key] = obj[key];
      continue;
    }
    if (isVisible(tuning, role, fieldPath)) {
      out[key] = obj[key];
    }
  }
  return out;
}

/**
 * Convenience for filtering an array of player records, where one player is
 * the requester ("own") and others are "other". The `ownPath` controls
 * inclusion of the requester's own slice; `otherPath` controls others'.
 *
 * Admins always see everything (because their visibility map sets both true).
 */
export function filterPlayers<P extends { playerId: string }>(
  tuning: Tuning,
  ctx: VisibilityContext,
  players: P[],
  ownPath = "player.ownPositions",
  otherPath = "player.otherPositions",
): P[] {
  const seeOwn = isVisible(tuning, ctx.role, ownPath);
  const seeOther = isVisible(tuning, ctx.role, otherPath);
  return players.filter((p) => (p.playerId === ctx.playerId ? seeOwn : seeOther));
}
