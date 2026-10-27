import { useState } from 'react'
import type { PageProps } from 'keycloakify/login/pages/PageProps'

import { FieldError } from '@/components/ui/field'
import { AuthShell, PageHeading, SubmitButton } from '@/mockups/AuthShell'
import { ProfileFields } from '../components/UserProfileFields'
import { useProfileForm } from '../lib/useProfileForm'
import type { KcContext } from '../KcContext'
import type { I18n } from '../i18n'
import { maskEmails } from '../lib/maskEmail'

type UpdateProfileContext = Extract<KcContext, { pageId: 'login-update-profile.ftl' }>

export default function LoginUpdateProfile({
  kcContext,
  i18n,
}: Omit<PageProps<UpdateProfileContext, I18n>, 'Template' | 'doUseDefaultCss' | 'classes'>) {
  const { url, message, messagesPerField, isAppInitiatedAction } = kcContext
  const [isSubmitting, setIsSubmitting] = useState(false)
  const form = useProfileForm({ kcContext, i18n })

  const globalError =
    form.showServerErrors && message?.type === 'error' && messagesPerField.exists('global')
      ? maskEmails(message.summary)
      : undefined

  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading title="Complete your profile" description="Add your full name to continue" />

        {globalError ? (
          <FieldError className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
            {globalError}
          </FieldError>
        ) : null}

        <form
          action={url.loginAction}
          method="post"
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            if (form.handleSubmit(event)) setIsSubmitting(true)
          }}
        >
          <ProfileFields form={form} i18n={i18n} />

          <SubmitButton type="submit" disabled={isSubmitting}>
            Continue
          </SubmitButton>
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
          ) : null}
        </form>
      </div>
    </AuthShell>
  )
}
