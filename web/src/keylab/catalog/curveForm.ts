import type { SwitchDetail } from '../api/switches.ts'
import type { FormState } from '../admin/switches/switchForm.ts'

/** The force curve chart draws an editor's form; the page hands it the published curve. */
export function curveForm(sw: SwitchDetail): FormState {
  const curve = sw.forceCurve ?? []
  return {
    name: sw.name,
    brand: sw.brand ?? '',
    type: sw.type,
    stem: sw.stemColor ?? '',
    force: sw.forceG?.toString() ?? '',
    act: sw.actuationMm?.toString() ?? '',
    total: sw.travelMm?.toString() ?? '',
    spring: sw.spring ?? '',
    points: curve
      .filter((p) => p.stroke !== 'release')
      .map((p, i) => ({ key: i, t: String(p.travelMm), f: String(p.forceG) })),
    release: curve.filter((p) => p.stroke === 'release'),
  }
}
