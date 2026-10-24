import { useState } from 'react'
import type { PageProps } from 'keycloakify/login/pages/PageProps'

import { buttonVariants } from '@/components/ui/button'
import { Field, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthShell, PageHeading, RequiredLabel, SubmitButton } from '@/mockups/AuthShell'
import type { KcContext } from '../KcContext'
import type { I18n } from '../i18n'

type UpdatePasswordContext = Extract<KcContext, { pageId: 'login-update-password.ftl' }>

export default function LoginUpdatePassword({
  kcContext,
}: Omit<PageProps<UpdatePasswordContext, I18n>, 'Template' | 'doUseDefaultCss' | 'classes'>) {
  const { url, messagesPerField, isAppInitiatedAction } = kcContext
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const passwordError = messagesPerField.existsError('password') ? messagesPerField.get('password') : undefined
  const confirmError = messagesPerField.existsError('password-confirm')
    ? messagesPerField.get('password-confirm')
    : undefined

  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading title="Set new password" description="Choose a new password for your account." />
        <form action={url.loginAction} method="post" className="space-y-4">
          <PasswordField
            id="password-new"
            name="password-new"
            label="Password"
            show={showPassword}
            onToggle={() => setShowPassword((visible) => !visible)}
            error={passwordError}
            autoFocus
          />
          <PasswordField
            id="password-confirm"
            name="password-confirm"
            label="Confirm password"
            show={showConfirm}
            onToggle={() => setShowConfirm((visible) => !visible)}
            error={confirmError}
          />
          <div className="space-y-3">
            <SubmitButton type="submit">Reset Password</SubmitButton>
            {isAppInitiatedAction ? (
              <button
                type="submit"
                name="cancel-aia"
                value="true"
                formNoValidate
                className="w-full text-sm text-muted-foreground underline underline-offset-4"
              >
                Cancel
              </button>
            ) : (
              <a href={url.loginUrl} className={buttonVariants({ variant: 'outline', className: 'h-11 w-full' })}>
                Back to login
              </a>
            )}
          </div>
        </form>
      </div>
    </AuthShell>
  )
}

function PasswordField({
  id,
  name,
  label,
  show,
  onToggle,
  error,
  autoFocus,
}: {
  id: string
  name: string
  label: string
  show: boolean
  onToggle: () => void
  error?: string
  autoFocus?: boolean
}) {
  return (
    <Field data-invalid={error ? true : undefined} className="gap-1.5">
      <Label htmlFor={id}>
        <RequiredLabel>{label}</RequiredLabel>
      </Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          autoFocus={autoFocus}
          aria-invalid={!!error}
          className="h-11 pr-20"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}
