/**
 * Masks an email address for display: the first 3 characters of the local part and the
 * domain stay visible, e.g. "vandat@gmail.com" -> "van•••••@gmail.com". Short local parts
 * keep at least one character hidden. The mask has a fixed width so it does not reveal
 * the length of the local part.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return email
  const visible = Math.min(3, at - 1)
  return `${email.slice(0, visible)}•••••${email.slice(at)}`
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** Masks every email address inside a message, such as a Keycloak message summary. */
export function maskEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, maskEmail)
}
