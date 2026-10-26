import type { PageProps } from 'keycloakify/login/pages/PageProps'

import { buttonVariants } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthShell, PageHeading, RequiredLabel, SubmitButton } from '@/mockups/AuthShell'
import type { KcContext } from '../KcContext'
import type { I18n } from '../i18n'

type ResetRequestContext = Extract<KcContext, { pageId: 'login-reset-password.ftl' }>

export default function LoginResetPassword({
  kcContext,
}: Omit<PageProps<ResetRequestContext, I18n>, 'Template' | 'doUseDefaultCss' | 'classes'>) {
  const { url, auth } = kcContext

  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading
          title="Forgot Password?"
          description="Enter your email address and we'll send you reset instructions."
        />
        <form action={url.loginAction} method="post" className="space-y-4">
          <Field className="gap-1.5">
            <Label htmlFor="username">
              <RequiredLabel>Email address</RequiredLabel>
            </Label>
            <Input
              id="username"
              name="username"
              type="email"
              autoFocus
              autoComplete="email"
              placeholder="Enter your email address"
              defaultValue={auth.attemptedUsername ?? ''}
              className="h-11"
            />
          </Field>
          <SubmitButton type="submit">Send Reset Link</SubmitButton>
          <a href={url.loginUrl} className={buttonVariants({ variant: 'outline', className: 'h-11 w-full' })}>
            Back to login
          </a>
        </form>
      </div>
    </AuthShell>
  )
}
