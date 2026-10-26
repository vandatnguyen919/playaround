import { useState } from 'react'
import type { ComponentType } from 'react'
import { Mail } from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import { kcSanitize } from 'keycloakify/lib/kcSanitize'
import type { PageProps } from 'keycloakify/login/pages/PageProps'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AuthShell,
  GitHubIcon,
  GoogleIcon,
  OrDivider,
  PageHeading,
  RequiredLabel,
  SubmitButton,
} from '@/mockups/AuthShell'
import { PasswordInput } from '../components/PasswordInput'
import type { KcContext } from '../KcContext'
import type { I18n } from '../i18n'

type LoginContext = Extract<KcContext, { pageId: 'login.ftl' }>

const providerIcons: Record<string, ComponentType<LucideProps>> = {
  google: GoogleIcon,
  github: GitHubIcon,
}

export default function Login({
  kcContext,
  i18n,
}: Omit<PageProps<LoginContext, I18n>, 'Template' | 'doUseDefaultCss' | 'classes'>) {
  const { realm, url, login, social, messagesPerField, registrationDisabled } = kcContext
  const { msg, msgStr } = i18n
  const [isSubmitting, setIsSubmitting] = useState(false)
  const providers = social?.providers ?? []
  const productName = kcContext.client.name ?? kcContext.realm.displayName

  const usernameError = messagesPerField.existsError('username') ? messagesPerField.get('username') : undefined
  const passwordError = messagesPerField.existsError('password') ? messagesPerField.get('password') : undefined
  const fieldGlobalError =
    messagesPerField.exists('global') && messagesPerField.existsError('global')
      ? messagesPerField.get('global')
      : undefined
  // A credential error reported identically on both fields is a form-level error.
  const credentialError =
    usernameError !== undefined && usernameError === passwordError ? usernameError : undefined
  const globalError = fieldGlobalError ?? credentialError
  // Errors are shown inline above; this carries info and success messages such as "email sent".
  const notice = kcContext.message && kcContext.message.type !== 'error' ? kcContext.message : undefined
  const showUsernameError = usernameError !== undefined && usernameError !== globalError
  const showPasswordError = passwordError !== undefined && passwordError !== globalError

  return (
    <AuthShell>
      <div className="space-y-6">
        <PageHeading title="Welcome Back 👋" description="Welcome back! Select a method to sign in" />

        {globalError ? (
          <FieldError className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
            {globalError}
          </FieldError>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="rounded-lg border bg-muted px-3 py-2 text-sm text-foreground"
            dangerouslySetInnerHTML={{ __html: kcSanitize(notice.summary) }}
          />
        ) : null}

        {providers.length > 0 ? (
          <>
            <div className="space-y-3">
              {providers.map((provider) => {
                const Icon = providerIcons[provider.providerId] ?? GoogleIcon
                return (
                  <Button
                    key={provider.alias}
                    type="button"
                    variant="outline"
                    className="h-11 w-full gap-2"
                    onClick={() => window.location.assign(provider.loginUrl)}
                  >
                    <Icon className="size-4" />
                    <span dangerouslySetInnerHTML={{ __html: kcSanitize(provider.displayName) }} />
                  </Button>
                )
              })}
            </div>
            <OrDivider />
          </>
        ) : null}

        <form action={url.loginAction} method="post" className="space-y-4" onSubmit={() => setIsSubmitting(true)}>
          <Field data-invalid={usernameError ? true : undefined} className="gap-1.5">
            <Label htmlFor="username">
              <RequiredLabel>{realm.loginWithEmailAllowed ? 'Email address' : 'Username'}</RequiredLabel>
            </Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="username"
                name="username"
                type="text"
                autoFocus
                autoComplete="username"
                placeholder="Enter your email address"
                defaultValue={login.username ?? ''}
                aria-invalid={!!usernameError}
                className="h-11 pl-9"
              />
            </div>
            {showUsernameError ? <FieldError>{usernameError}</FieldError> : null}
          </Field>

          <Field data-invalid={passwordError ? true : undefined} className="gap-1.5">
            <Label htmlFor="password">
              <RequiredLabel>Password</RequiredLabel>
            </Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••••••••••"
              aria-invalid={!!passwordError}
              showLabel={msgStr('showPassword')}
              hideLabel={msgStr('hidePassword')}
            />
            {showPasswordError ? <FieldError>{passwordError}</FieldError> : null}
          </Field>

          {realm.rememberMe || realm.resetPasswordAllowed ? (
            <div className="flex items-center justify-between">
              {realm.rememberMe ? (
                <label htmlFor="rememberMe" className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    id="rememberMe"
                    name="rememberMe"
                    value="on"
                    defaultChecked={login.rememberMe === 'on'}
                  />
                  {msg('rememberMe')}
                </label>
              ) : (
                <span />
              )}
              {realm.resetPasswordAllowed ? (
                <a
                  href={url.loginResetCredentialsUrl}
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {msg('doForgotPassword')}
                </a>
              ) : null}
            </div>
          ) : null}

          <SubmitButton type="submit" disabled={isSubmitting}>
            {msg('doLogIn')} to {productName}
          </SubmitButton>
        </form>

        {realm.registrationAllowed && !registrationDisabled ? (
          <p className="text-center text-sm text-muted-foreground">
            {"Don't have an account yet? "}
            <a href={url.registrationUrl} className="font-medium text-foreground underline underline-offset-4">
              Sign Up
            </a>
          </p>
        ) : null}
      </div>
    </AuthShell>
  )
}
