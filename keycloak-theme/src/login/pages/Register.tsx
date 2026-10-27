import { useState } from 'react'
import type { PageProps } from 'keycloakify/login/pages/PageProps'

import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError } from '@/components/ui/field'
import { AuthShell, PageHeading, SubmitButton } from '@/mockups/AuthShell'
import { ProfileFields } from '../components/UserProfileFields'
import { useProfileForm } from '../lib/useProfileForm'
import type { KcContext } from '../KcContext'
import type { I18n } from '../i18n'
import { maskEmails } from '../lib/maskEmail'

type RegisterContext = Extract<KcContext, { pageId: 'register.ftl' }>

export default function Register({
  kcContext,
  i18n,
}: Omit<PageProps<RegisterContext, I18n>, 'Template' | 'doUseDefaultCss' | 'classes'>) {
  const { url, message, messagesPerField, termsAcceptanceRequired } = kcContext
  const { msg } = i18n
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const form = useProfileForm({ kcContext, i18n })

  const globalError = message?.type === 'error' && messagesPerField.exists('global') ? maskEmails(message.summary) : undefined
  const canSubmit = (!termsAcceptanceRequired || termsAccepted) && !isSubmitting

  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading title="Create your account" description="Sign up to unlock the full playground" />

        {globalError ? (
          <FieldError className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
            {globalError}
          </FieldError>
        ) : null}

        <form
          action={url.registrationAction}
          method="post"
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            if (form.handleSubmit(event)) setIsSubmitting(true)
          }}
        >
          <ProfileFields form={form} i18n={i18n} />

          {termsAcceptanceRequired ? (
            <Field data-invalid={messagesPerField.existsError('termsAccepted') || undefined}>
              <label htmlFor="termsAccepted" className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox
                  id="termsAccepted"
                  name="termsAccepted"
                  value="on"
                  className="mt-0.5"
                  checked={termsAccepted}
                  onCheckedChange={setTermsAccepted}
                  aria-invalid={messagesPerField.existsError('termsAccepted')}
                />
                <span>{msg('acceptTerms')}</span>
              </label>
              {messagesPerField.existsError('termsAccepted') ? (
                <FieldError>{messagesPerField.get('termsAccepted')}</FieldError>
              ) : null}
            </Field>
          ) : null}

          <SubmitButton type="submit" disabled={!canSubmit}>
            Sign up to {kcContext.client.name ?? kcContext.realm.displayName}
          </SubmitButton>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {'Already have an account? '}
          <a href={url.loginUrl} className="font-medium text-foreground underline underline-offset-4">
            Log In
          </a>
        </p>
      </div>
    </AuthShell>
  )
}
