import { useState } from 'react'
import type { PageProps } from 'keycloakify/login/pages/PageProps'

import { FieldError } from '@/components/ui/field'
import { AuthShell, PageHeading, SubmitButton } from '@/mockups/AuthShell'
import { ProfileFields } from '../components/UserProfileFields'
import { useProfileForm } from '../lib/useProfileForm'
import type { KcContext } from '../KcContext'
import type { I18n } from '../i18n'

type IdpReviewContext = Extract<KcContext, { pageId: 'idp-review-user-profile.ftl' }>

/**
 * First broker login "Review Profile" step (idp-review-user-profile.ftl in Keycloak 26.8.1,
 * same page ID in Keycloakify 11.16.3). The Google and GitHub mappers fill fullName, so with
 * the realm's "missing" setting this only appears when the provider sent no usable name
 * (for example a GitHub account with no display name).
 */
export default function IdpReviewUserProfile({
  kcContext,
  i18n,
}: Omit<PageProps<IdpReviewContext, I18n>, 'Template' | 'doUseDefaultCss' | 'classes'>) {
  const { url, message, messagesPerField } = kcContext
  const [isSubmitting, setIsSubmitting] = useState(false)
  const form = useProfileForm({ kcContext, i18n })

  const globalError =
    form.showServerErrors && message?.type === 'error' && messagesPerField.exists('global')
      ? message.summary
      : undefined

  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading
          title="Confirm your details"
          description="Your sign-in provider didn't share everything we need. Check your details to finish creating your account."
        />

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
        </form>
      </div>
    </AuthShell>
  )
}
