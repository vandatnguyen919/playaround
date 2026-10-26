import { useState } from 'react'
import type { PageProps } from 'keycloakify/login/pages/PageProps'

import { buttonVariants } from '@/components/ui/button'
import { Field, FieldError } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { AuthShell, PageHeading, RequiredLabel, SubmitButton } from '@/mockups/AuthShell'
import { PasswordInput, PasswordMatchHint } from '../components/PasswordInput'
import type { KcContext } from '../KcContext'
import type { I18n } from '../i18n'

type UpdatePasswordContext = Extract<KcContext, { pageId: 'login-update-password.ftl' }>

export default function LoginUpdatePassword({
  kcContext,
  i18n,
}: Omit<PageProps<UpdatePasswordContext, I18n>, 'Template' | 'doUseDefaultCss' | 'classes'>) {
  const { url, messagesPerField, isAppInitiatedAction } = kcContext
  const { msgStr } = i18n
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const passwordError = messagesPerField.existsError('password') ? messagesPerField.get('password') : undefined
  const confirmError = messagesPerField.existsError('password-confirm')
    ? messagesPerField.get('password-confirm')
    : undefined
  const mismatch = confirm !== '' && confirm !== password

  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading title="Set new password" description="Choose a new password for your account." />
        <form
          action={url.loginAction}
          method="post"
          className="space-y-4"
          onSubmit={(event) => {
            const submitter = (event.nativeEvent as SubmitEvent).submitter
            if (mismatch && !submitter?.hasAttribute('formnovalidate')) event.preventDefault()
          }}
        >
          <Field data-invalid={passwordError ? true : undefined} className="gap-1.5">
            <Label htmlFor="password-new">
              <RequiredLabel>Password</RequiredLabel>
            </Label>
            <PasswordInput
              id="password-new"
              name="password-new"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={!!passwordError}
              showLabel={msgStr('showPassword')}
              hideLabel={msgStr('hidePassword')}
            />
            {passwordError ? <FieldError>{passwordError}</FieldError> : null}
          </Field>
          <Field data-invalid={confirmError || mismatch ? true : undefined} className="gap-1.5">
            <Label htmlFor="password-confirm">
              <RequiredLabel>Confirm password</RequiredLabel>
            </Label>
            <PasswordInput
              id="password-confirm"
              name="password-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              aria-invalid={!!confirmError || mismatch}
              aria-describedby="password-confirm-match"
              showLabel={msgStr('showPassword')}
              hideLabel={msgStr('hidePassword')}
            />
            <PasswordMatchHint id="password-confirm-match" password={password} confirm={confirm} />
            {confirmError ? <FieldError>{confirmError}</FieldError> : null}
          </Field>
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
