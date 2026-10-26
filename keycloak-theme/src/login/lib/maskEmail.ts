/**
 * Masks an email address for display: the first character and the domain stay visible,
 * e.g. "vandat@gmail.com" -> "v•••••@gmail.com". The mask has a fixed width so it does
 * not reveal the length of the local part.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return email
  return `${email[0]}•••••${email.slice(at)}`
}
