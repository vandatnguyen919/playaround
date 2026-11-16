import type { SwitchSummary } from '../api/switches.ts'
import { typeLabel } from './switchLook.ts'

// Compare mode (US-03): up to three switches with a recording, heard side
// by side. The pure parts, tested on their own.

export const COMPARE_MAX = 3

/**
 * Picks or unpicks a switch. A switch without a recording cannot be picked,
 * and a fourth pick is ignored (Clear or unpick one first).
 */
export function togglePick(picked: string[], slug: string, recorded: boolean): string[] {
  if (picked.includes(slug)) {
    return picked.filter((s) => s !== slug)
  }
  if (!recorded || picked.length >= COMPARE_MAX) {
    return picked
  }
  return [...picked, slug]
}

type Specs = Pick<SwitchSummary, 'type' | 'forceG' | 'actuationMm'>

/** The compare panel's spec line: "LINEAR · 50G". */
export function compareSpec(sw: Specs): string {
  return [typeLabel(sw.type), sw.forceG === undefined ? null : `${sw.forceG}g`]
    .filter((part) => part !== null)
    .join(' · ')
    .toUpperCase()
}

/** The landing strip's spec line: "LINEAR · 50G · 2.0MM". */
export function stripSpec(sw: Specs): string {
  return [compareSpec(sw), sw.actuationMm === undefined ? null : `${Number(sw.actuationMm).toFixed(1)}MM`]
    .filter((part) => part !== null)
    .join(' · ')
}
