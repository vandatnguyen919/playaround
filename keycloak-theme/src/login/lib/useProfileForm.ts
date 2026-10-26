import { useState } from 'react'
import type { FormEvent } from 'react'
import { useUserProfileForm } from 'keycloakify/login/lib/useUserProfileForm'

import { isSubmitResponse, markSubmitted } from './submitMarker'
import type { KcContext } from '../KcContext'
import type { I18n } from '../i18n'

type ProfileContext = Extract<
  KcContext,
  { pageId: 'register.ftl' | 'login-update-profile.ftl' | 'idp-review-user-profile.ftl' }
>

// Keycloakify inserts the password fields right after the login identifier, which pushes
// Full name below them. This is the order the design wants.
const fieldOrder = ['fullName', 'username', 'email', 'password', 'password-confirm']

function fieldRank(name: string): number {
  const index = fieldOrder.indexOf(name)
  return index === -1 ? fieldOrder.length : index
}

/**
 * Keycloakify's user profile form, with errors held back until they are useful:
 * client-side errors appear once a field loses focus or the user tries to submit,
 * and server errors only on the page Keycloak returns after a submit.
 */
export function useProfileForm({ kcContext, i18n }: { kcContext: ProfileContext; i18n: I18n }) {
  const { formState, dispatchFormAction } = useUserProfileForm({
    kcContext,
    i18n,
    doMakeUserConfirmPassword: true,
  })

  // Fields the user has left or tried to submit. Keycloakify gates its own errors on this,
  // but not server errors, and a server error replaces the client-side "required" check.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const showServerErrors = isSubmitResponse(kcContext.pageId)

  const fieldStates = [...formState.formFieldStates].sort(
    (a, b) => fieldRank(a.attribute.name) - fieldRank(b.attribute.name),
  )

  /** Use as the form's onSubmit. Returns false (and shows every field's errors) when the form is not valid yet. */
  function handleSubmit(event: FormEvent<HTMLFormElement>): boolean {
    // Cancel buttons (formNoValidate) post without the profile being valid.
    if ((event.nativeEvent as SubmitEvent).submitter?.hasAttribute('formnovalidate')) return true
    if (!formState.isFormSubmittable) {
      event.preventDefault()
      for (const { attribute } of formState.formFieldStates) {
        dispatchFormAction({ action: 'focus lost', name: attribute.name, fieldIndex: undefined })
      }
      setTouched(new Set(formState.formFieldStates.map(({ attribute }) => attribute.name)))
      return false
    }
    markSubmitted(kcContext.pageId)
    return true
  }

  function handleBlur(name: string) {
    dispatchFormAction({ action: 'focus lost', name, fieldIndex: undefined })
    setTouched((previous) => (previous.has(name) ? previous : new Set(previous).add(name)))
  }

  return {
    fieldStates,
    dispatchFormAction,
    handleBlur,
    showServerErrors,
    /** Server errors show on Keycloak's answer to a submit, or once the user has touched the field. */
    showsServerErrorFor: (name: string) => showServerErrors || touched.has(name),
    handleSubmit,
  }
}

export type ProfileForm = ReturnType<typeof useProfileForm>
