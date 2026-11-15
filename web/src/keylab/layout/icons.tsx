// Icons as drawn in HomeDesktop.dc.html and Main.dc.html: 24px grid,
// square caps, stroke in currentColor.

type IconProps = { size?: number; stroke?: number }

function Svg({ size = 20, stroke = 2.4, miter = false, children }: IconProps & {
  miter?: boolean
  children: React.ReactNode
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="square"
      strokeLinejoin={miter ? 'miter' : undefined}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function BuildIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="6" width="20" height="12" />
      <path d="M6 10h1M10 10h1M14 10h1M18 10h1M7 14h10" />
    </Svg>
  )
}

export function SwitchesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.5v7M8.5 6h7" />
      <rect x="4.5" y="11" width="15" height="9.5" />
    </Svg>
  )
}

export function ModsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <rect x="13" y="5" width="4" height="4" />
      <rect x="7" y="15" width="4" height="4" />
    </Svg>
  )
}

export function KeycapsIcon(props: IconProps) {
  return (
    <Svg {...props} miter>
      <path d="M3.5 19.5h17L18 6H6z" />
      <path d="M9 10.5h6" />
    </Svg>
  )
}

export function CaseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="7" width="19" height="10" />
      <path d="M2.5 12.5h19" />
    </Svg>
  )
}

export function PlaygroundIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h2l2-6 3 12 3-9 2 5 2-2h4" />
    </Svg>
  )
}

export function BuildsIcon(props: IconProps) {
  return (
    <Svg {...props} miter>
      <path d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z" />
    </Svg>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props} miter>
      <rect x="9" y="9" width="6" height="6" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
    </Svg>
  )
}
