/**
 * Upgrades and modifier tables. Tier 1 ships the schema and helpers only: the pool is empty, but
 * every kaiju and squad already carries a `mods` table and systems read it through `modMult` and
 * `hasModFlag`, so Tier 2 upgrades need no system changes to take effect.
 */

import type { ModFlag, ModMultKey, Mods, UpgradeDef } from './schema';

/** The draft pool. Empty until Tier 2. */
export const UPGRADES: readonly UpgradeDef[] = [];

export function upgradeDef(id: string): UpgradeDef {
  const def = UPGRADES.find((u) => u.id === id);
  if (!def) throw new Error(`upgrade "${id}" is not registered`);
  return def;
}

export function emptyMods(): Mods {
  return { mult: {}, flags: [] };
}

/** Multiplier for a key; 1 when no upgrade touches it. */
export function modMult(mods: Mods, key: ModMultKey): number {
  return mods.mult[key] ?? 1;
}

export function hasModFlag(mods: Mods, flag: ModFlag): boolean {
  return mods.flags.includes(flag);
}

/** Folds an upgrade's modifiers into an owner's table (multipliers multiply, flags union). */
export function addMods(target: Mods, extra: Mods): void {
  for (const key of Object.keys(extra.mult) as ModMultKey[]) {
    target.mult[key] = (target.mult[key] ?? 1) * (extra.mult[key] ?? 1);
  }
  for (const flag of extra.flags) {
    if (!target.flags.includes(flag)) target.flags.push(flag);
  }
}
