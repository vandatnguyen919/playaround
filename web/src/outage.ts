import axios from 'axios'

export const UNAVAILABLE = 'The service is temporarily unavailable. Please try again in a minute.'

// The gateway answers 503 (Redis or the API down, circuit open) and 504 (API
// too slow) with JSON { error, message } meant for the user.
export function outageMessage(error: unknown): string | null {
  if (!axios.isAxiosError(error)) {
    return null
  }
  const status = error.response?.status
  if (status !== 502 && status !== 503 && status !== 504) {
    return null
  }
  const message = (error.response?.data as { message?: unknown } | undefined)?.message
  return typeof message === 'string' ? message : UNAVAILABLE
}
