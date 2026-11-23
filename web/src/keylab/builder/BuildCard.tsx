import type { Build } from '../api/builds.ts'
import Keyboard from './Keyboard.tsx'
import { caseLook } from './caseParts.ts'
import { keyColors, type Profile } from './keycaps.ts'
import { caseLine, keycapsLine, layoutLabel, modNames, stemColor, switchName, switchType, type PartNames } from './savedBuild.ts'

// BuildCard.dc.html, summary variant: the build on its keyboard preview, its
// name and layout, and the switch, mods, keycaps and case. The preview is
// drawn, not played: the playground plays builds (US-14).

const silent = () => undefined

export default function BuildCard({ build, names, keyboardWidth }: { build: Build; names: PartNames; keyboardWidth: number }) {
  const set = names.keycapSets.find((s) => s.slug === build.keycaps?.set)
  const mods = modNames(build, names)
  return (
    <article className="bc" data-testid="build-card">
      <div className="bc-stage" aria-hidden="true">
        <Keyboard
          width={keyboardWidth}
          onStroke={silent}
          colors={set ? keyColors(set.colors) : undefined}
          profile={build.keycaps?.profile as Profile | undefined}
          {...caseLook(build.case)}
        />
      </div>
      <div className="bc-head">
        <h3 className="bc-name">{build.name}</h3>
        <span className="mono bc-layout">{layoutLabel(build.layout)}</span>
      </div>
      <dl className="bc-specs">
        <dt>Switch</dt>
        <dd className="bc-switch">
          <span aria-hidden="true" className="bc-stem" style={{ background: stemColor(build, names) }} />
          <span className="bc-sw">{switchName(build, names)}</span>
          <span className="mono bc-type">{switchType(build, names)}</span>
        </dd>
        <dt>Mods</dt>
        <dd className="bc-mods">
          {mods.length === 0 ? <span className="mono">None</span> : mods.map((m) => <span key={m} className="bc-mod">{m}</span>)}
        </dd>
        <dt>Keycaps</dt>
        <dd className="mono">{keycapsLine(build, names)}</dd>
        <dt>Case</dt>
        <dd className="mono">{caseLine(build, names)}</dd>
      </dl>
    </article>
  )
}
