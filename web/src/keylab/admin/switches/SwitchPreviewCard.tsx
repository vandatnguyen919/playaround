import SwitchCard from '../../catalog/SwitchCard.tsx'
import type { SwitchType } from './switchForm.ts'

// The library card (SwitchCard.dc.html) as the library would show this
// switch, drawn from the form as it is typed. It says "No sound yet" until
// the stock press and release are ready.

export default function SwitchPreviewCard(props: {
  name: string
  type: SwitchType
  typeLabel: string
  stem: string
  force: string
  act: string
  profile?: string
  noSound?: boolean
}) {
  // Numbers get their unit; anything else is left out until the API refuses it.
  const force = Number(props.force.trim())
  const act = Number(props.act.trim())
  return (
    <SwitchCard
      noSound={props.noSound ?? true}
      sw={{
        name: props.name,
        type: props.type,
        stemColor: props.stem,
        forceG: props.force.trim() !== '' && Number.isFinite(force) ? force : undefined,
        actuationMm: props.act.trim() !== '' && Number.isFinite(act) ? act : undefined,
        profile: props.profile,
      }}
    />
  )
}
