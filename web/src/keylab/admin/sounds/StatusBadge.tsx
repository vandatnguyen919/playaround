// StatusBadge.dc.html for sounds: Recorded, Missing, Processing, and Failed
// (the design has no failed badge; it reuses Missing's coral).

export type SoundBadge = 'recorded' | 'missing' | 'processing' | 'failed'

const LABEL: Record<SoundBadge, string> = {
  recorded: 'Recorded',
  missing: 'Missing',
  processing: 'Processing',
  failed: 'Failed',
}

export default function StatusBadge({ status }: { status: SoundBadge }) {
  return (
    <span className={`sbadge ${status}`}>
      <span aria-hidden="true" className="sbadge-dot" />
      {LABEL[status]}
    </span>
  )
}
