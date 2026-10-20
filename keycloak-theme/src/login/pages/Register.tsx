import { useState } from 'react'
import type { ChangeEvent, ComponentType } from 'react'
import { Eye, EyeOff, Lock, Mail, User } from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import { useUserProfileForm } from 'keycloakify/login/lib/useUserProfileForm'
import type { FormFieldState } from 'keycloakify/login/lib/useUserProfileForm'
import type { PageProps } from 'keycloakify/login/pages/PageProps'

import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthShell, PageHeading, RequiredLabel, SubmitButton } from '@/mockups/AuthShell'
import type { KcContext } from '../KcContext'
import type { I18n } from '../i18n'

type RegisterContext = Extract<KcContext, { pageId: 'register.ftl' }>

type FieldKind = {
  Icon: ComponentType<LucideProps>
  type: string
  autoComplete: string
  placeholder: string
  label?: string
}

const fieldKinds: Record<string, FieldKind> = {
  fullName: { Icon: User, type: 'text', autoComplete: 'name', placeholder: 'Enter your name', label: 'Full name' },
  email: { Icon: Mail, type: 'email', autoComplete: 'email', placeholder: 'Enter your email address', label: 'Email' },
  username: { Icon: User, type: 'text', autoComplete: 'username', placeholder: 'Choose a username', label: 'Username' },
  password: { Icon: Lock, type: 'password', autoComplete: 'new-password', placeholder: '••••••••••••••••', label: 'Password' },
  'password-confirm': {
    Icon: Lock,
    type: 'password',
    autoComplete: 'new-password',
    placeholder: '••••••••••••••••',
    label: 'Confirm password',
  },
}

const fallbackKind: FieldKind = { Icon: User, type: 'text', autoComplete: 'off', placeholder: '' }

// Keycloakify inserts the password fields right after the login identifier, which pushes
// Full name below them. This is the order the design wants.
const fieldOrder = ['fullName', 'username', 'email', 'password', 'password-confirm']

function fieldRank(name: string): number {
  const index = fieldOrder.indexOf(name)
  return index === -1 ? fieldOrder.length : index
}

export default function Register({
  kcContext,
  i18n,
}: Omit<PageProps<RegisterContext, I18n>, 'Template' | 'doUseDefaultCss' | 'classes'>) {
  const { url, message, messagesPerField, termsAcceptanceRequired } = kcContext
  const { msg, msgStr, advancedMsgStr } = i18n
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)

  const { formState, dispatchFormAction } = useUserProfileForm({
    kcContext,
    i18n,
    doMakeUserConfirmPassword: true,
  })

  const orderedFieldStates = [...formState.formFieldStates].sort(
    (a, b) => fieldRank(a.attribute.name) - fieldRank(b.attribute.name),
  )

  const globalError = message?.type === 'error' && messagesPerField.exists('global') ? message.summary : undefined
  const canSubmit = formState.isFormSubmittable && (!termsAcceptanceRequired || termsAccepted) && !isSubmitting

  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading title="Create your account" description="Sign up to unlock the full playground" />

        {globalError ? (
          <FieldError className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
            {globalError}
          </FieldError>
        ) : null}

        <form
          action={url.registrationAction}
          method="post"
          className="space-y-4"
          onSubmit={() => setIsSubmitting(true)}
        >
          {orderedFieldStates.map((state) => {
            const { name, annotations } = state.attribute
            if (annotations.inputType === 'hidden') {
              return <input key={name} type="hidden" name={name} value={String(state.valueOrValues)} />
            }
            return (
              <ProfileField
                key={name}
                state={state}
                label={fieldKinds[name]?.label ?? advancedMsgStr(state.attribute.displayName ?? name)}
                onValueChange={(valueOrValues) =>
                  dispatchFormAction({ action: 'update', name, valueOrValues })
                }
                onBlur={() => dispatchFormAction({ action: 'focus lost', name, fieldIndex: undefined })}
                showPasswordLabel={msgStr('showPassword')}
                hidePasswordLabel={msgStr('hidePassword')}
              />
            )
          })}

          {termsAcceptanceRequired ? (
            <Field data-invalid={messagesPerField.existsError('termsAccepted') || undefined}>
              <label htmlFor="termsAccepted" className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox
                  id="termsAccepted"
                  name="termsAccepted"
                  value="on"
                  className="mt-0.5"
                  checked={termsAccepted}
                  onCheckedChange={setTermsAccepted}
                  aria-invalid={messagesPerField.existsError('termsAccepted')}
                />
                <span>{msg('acceptTerms')}</span>
              </label>
              {messagesPerField.existsError('termsAccepted') ? (
                <FieldError>{messagesPerField.get('termsAccepted')}</FieldError>
              ) : null}
            </Field>
          ) : null}

          <SubmitButton type="submit" disabled={!canSubmit}>
            Sign up to {kcContext.client.name ?? kcContext.realm.displayName}
          </SubmitButton>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {'Already have an account? '}
          <a href={url.loginUrl} className="font-medium text-foreground underline underline-offset-4">
            Log In
          </a>
        </p>
      </div>
    </AuthShell>
  )
}

function ProfileField({
  state,
  label,
  onValueChange,
  onBlur,
  showPasswordLabel,
  hidePasswordLabel,
}: {
  state: FormFieldState
  label: string
  onValueChange: (value: string) => void
  onBlur: () => void
  showPasswordLabel: string
  hidePasswordLabel: string
}) {
  const { attribute, displayableErrors, valueOrValues } = state
  const { Icon, type, autoComplete, placeholder } = fieldKinds[attribute.name] ?? fallbackKind
  const [showPassword, setShowPassword] = useState(false)
  const isPassword = type === 'password'
  const hasError = displayableErrors.length > 0
  const id = attribute.name

  return (
    <Field data-invalid={hasError || undefined} className="gap-1.5">
      <Label htmlFor={id}>{attribute.required ? <RequiredLabel>{label}</RequiredLabel> : label}</Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          name={attribute.name}
          type={isPassword && showPassword ? 'text' : type}
          autoComplete={attribute.autocomplete ?? autoComplete}
          placeholder={placeholder}
          value={String(valueOrValues)}
          readOnly={attribute.readOnly}
          aria-invalid={hasError}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value)}
          onBlur={onBlur}
          className={isPassword ? 'h-11 pl-9 pr-10' : 'h-11 pl-9'}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            <span className="sr-only">{showPassword ? hidePasswordLabel : showPasswordLabel}</span>
          </button>
        ) : null}
      </div>
      {hasError ? <FieldError errors={displayableErrors.map((error) => ({ message: error.errorMessageStr }))} /> : null}
    </Field>
  )
}
