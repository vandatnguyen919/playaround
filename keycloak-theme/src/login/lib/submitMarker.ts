// Keycloak validates some profile forms before the user has typed anything: the
// VERIFY_PROFILE required action (login-update-profile.ftl) renders its first GET with
// "Please specify this field." already attached as a server error. Keycloakify shows
// server errors unconditionally, so the page opened with red fields.
//
// A server error is only worth showing as the answer to a submit. The form records its
// page ID just before posting; the next page load reads and clears that record once,
// at module load, so StrictMode double renders cannot consume it twice.

const KEY = 'kc-submitted-page'

function readAndClear(): { storage: boolean; pageId?: string } {
  try {
    const pageId = sessionStorage.getItem(KEY) ?? undefined
    sessionStorage.removeItem(KEY)
    return { storage: true, pageId }
  } catch {
    return { storage: false }
  }
}

const submitted = readAndClear()

/**
 * True when this page load is Keycloak's response to a submit of the same page.
 * Without session storage there is no way to tell, so server errors are shown as before.
 */
export function isSubmitResponse(pageId: string): boolean {
  return !submitted.storage || submitted.pageId === pageId
}

export function markSubmitted(pageId: string): void {
  try {
    sessionStorage.setItem(KEY, pageId)
  } catch {
    // Storage blocked: isSubmitResponse already falls back to showing server errors.
  }
}
