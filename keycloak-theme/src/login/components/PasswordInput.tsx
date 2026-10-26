import { useState } from 'react'
import type { ComponentProps } from 'react'
import { Check, Eye, EyeOff, Lock, X } from 'lucide-react'
import { cn } from 'cn'

import { Input } from '@/components/ui/input'

/**
 * Password input with a themed show/hide toggle. The browser's own reveal control
 * (Edge's ::-ms-reveal) is hidden in index.css so only this toggle appears.
 */
export function PasswordInput({
  showLabel,
  hideLabel,
  withIcon = true,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, 'type'> & {
  showLabel: string
  hideLabel: string
  withIcon?: boolean
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      {withIcon ? (
        <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      ) : null}
      <Input
        type={visible ? 'text' : 'password'}
        className={cn('h-11 pr-11', withIcon && 'pl-9', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        aria-controls={props.id}
        className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  )
}

/** Live "passwords match" feedback for a confirm field. Silent until the confirm field has a value. */
export function PasswordMatchHint({ id, password, confirm }: { id?: string; password: string; confirm: string }) {
  if (!confirm) return null
  const matches = password === confirm

  return (
    <p
      id={id}
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-1.5 text-sm',
        matches ? 'text-emerald-600 dark:text-emerald-500' : 'text-destructive',
      )}
    >
      {matches ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
      {matches ? 'Passwords match' : "Passwords don't match"}
    </p>
  )
}
