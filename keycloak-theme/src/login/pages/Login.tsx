import { useState } from 'react'
import { kcSanitize } from 'keycloakify/lib/kcSanitize'
import type { PageProps } from 'keycloakify/login/pages/PageProps'
import type { KcContext } from '../KcContext'
import type { I18n } from '../i18n'

type LoginContext = Extract<KcContext, { pageId: 'login.ftl' }>

export default function Login({
  kcContext,
  i18n,
}: Omit<PageProps<LoginContext, I18n>, 'Template' | 'doUseDefaultCss' | 'classes'>) {
  const { realm, url, login, social, messagesPerField, registrationDisabled } = kcContext
  const { msg } = i18n
  const [isSubmitting, setIsSubmitting] = useState(false)
  const hasFieldError = messagesPerField.existsError('username', 'password')
  const providers = social?.providers ?? []
  const productName = kcContext.client.name ?? kcContext.realm.displayName

  return (
    <main className="min-h-screen bg-background p-3 text-foreground">
      <div className="grid min-h-[calc(100vh-1.5rem)] overflow-hidden rounded-[1.5rem] bg-card shadow-sm lg:grid-cols-2">
        <section className="relative hidden overflow-hidden rounded-[1.5rem] bg-[#17191c] lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,.24),transparent_28%),linear-gradient(145deg,#0c0d0f,#4b5057_52%,#101113)]" />
          <div className="absolute -left-1/4 top-1/4 h-3/4 w-[140%] -rotate-12 rounded-[45%] border-[28px] border-white/10 shadow-[0_0_80px_rgba(255,255,255,.12)]" />
          <div className="absolute -left-1/4 top-1/3 h-3/4 w-[140%] rotate-[18deg] rounded-[45%] border-[12px] border-white/10" />
          <div className="absolute inset-x-12 bottom-12 z-10 max-w-md text-white">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-white/60">
              authn-authz-playground
            </p>
            <h1 className="text-4xl font-semibold tracking-tight">One cookie. Zero tokens.</h1>
            <p className="mt-4 text-sm leading-6 text-white/65">
              A focused sign-in experience for the BFF authentication playground.
            </p>
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-12 sm:px-12">
          <div className="w-full max-w-sm">
            <div className="mb-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {productName}
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">{msg('loginAccountTitle')}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Welcome back! Select a method to sign in.
              </p>
            </div>

            {providers.length > 0 && (
              <>
                <div className="grid gap-3">
                  {providers.map((provider) => (
                    <a
                      key={provider.alias}
                      href={provider.loginUrl}
                      className="flex h-10 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
                    >
                      <span aria-hidden="true" className="text-base font-semibold">
                        {provider.providerId === 'google' ? 'G' : '●'}
                      </span>
                      <span dangerouslySetInnerHTML={{ __html: kcSanitize(provider.displayName) }} />
                    </a>
                  ))}
                </div>
                <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  <span>OR</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              </>
            )}

            <form
              action={url.loginAction}
              method="post"
              className="space-y-4"
              onSubmit={() => setIsSubmitting(true)}
            >
              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium">
                  {realm.loginWithEmailAllowed ? msg('email') : msg('username')}
                  <span className="text-destructive"> *</span>
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoFocus
                  autoComplete="username"
                  defaultValue={login.username ?? ''}
                  aria-invalid={hasFieldError}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">
                  {msg('password')}
                  <span className="text-destructive"> *</span>
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={hasFieldError}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              {hasFieldError && (
                <p className="text-sm text-destructive" role="alert">
                  {messagesPerField.getFirstError('username', 'password')}
                </p>
              )}

              <div className="flex items-center justify-between text-sm">
                {realm.rememberMe && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="rememberMe" defaultChecked={login.rememberMe === 'on'} />
                    {msg('rememberMe')}
                  </label>
                )}
                {realm.resetPasswordAllowed && (
                  <a href={url.loginResetCredentialsUrl} className="font-medium underline-offset-4 hover:underline">
                    {msg('doForgotPassword')}
                  </a>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="h-10 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {msg('doLogIn')}
              </button>
            </form>

            {realm.registrationAllowed && !registrationDisabled && (
              <p className="mt-6 text-center text-sm text-muted-foreground">
                {msg('noAccount')}{' '}
                <a href={url.registrationUrl} className="font-medium text-foreground underline underline-offset-4">
                  {msg('doRegister')}
                </a>
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
