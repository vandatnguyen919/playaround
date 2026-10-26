import type { ChangeEvent, ComponentType } from 'react'
import { Lock, Mail, User } from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { FormFieldError, FormFieldState } from 'keycloakify/login/lib/useUserProfileForm'

import { Field, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RequiredLabel } from '@/mockups/AuthShell'
import { PasswordInput, PasswordMatchHint } from './PasswordInput'
import type { ProfileForm } from '../lib/useProfileForm'
import type { I18n } from '../i18n'

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

export function ProfileFields({
  form,
  i18n,
}: {
  form: ProfileForm
  i18n: I18n
}) {
  const { fieldStates, dispatchFormAction, handleBlur, showsServerErrorFor } = form
  const { msgStr, advancedMsgStr } = i18n
  const password = String(fieldStates.find((state) => state.attribute.name === 'password')?.valueOrValues ?? '')

  return fieldStates.map((state) => {
    const { name, annotations } = state.attribute
    if (annotations.inputType === 'hidden') {
      return <input key={name} type="hidden" name={name} value={String(state.valueOrValues)} />
    }
    return (
      <ProfileField
        key={name}
        state={state}
        label={fieldKinds[name]?.label ?? advancedMsgStr(state.attribute.displayName ?? name)}
        password={password}
        showServerErrors={showsServerErrorFor(name)}
        onValueChange={(valueOrValues) => dispatchFormAction({ action: 'update', name, valueOrValues })}
        onBlur={() => handleBlur(name)}
        showPasswordLabel={msgStr('showPassword')}
        hidePasswordLabel={msgStr('hidePassword')}
      />
    )
  })
}

function isShown(error: FormFieldError, fieldName: string, showServerErrors: boolean): boolean {
  if (error.source.type === 'server') return showServerErrors
  // The confirm field has live match feedback instead of Keycloakify's on-blur message.
  if (fieldName === 'password-confirm' && error.source.type === 'other') {
    return error.source.rule !== 'passwordConfirmMatchesPassword'
  }
  return true
}

function ProfileField({
  state,
  label,
  password,
  showServerErrors,
  onValueChange,
  onBlur,
  showPasswordLabel,
  hidePasswordLabel,
}: {
  state: FormFieldState
  label: string
  password: string
  showServerErrors: boolean
  onValueChange: (value: string) => void
  onBlur: () => void
  showPasswordLabel: string
  hidePasswordLabel: string
}) {
  const { attribute, valueOrValues } = state
  const { Icon, type, autoComplete, placeholder } = fieldKinds[attribute.name] ?? fallbackKind
  const errors = state.displayableErrors.filter((error) => isShown(error, attribute.name, showServerErrors))
  const id = attribute.name
  const value = String(valueOrValues)
  const isConfirm = attribute.name === 'password-confirm'
  const mismatch = isConfirm && value !== '' && value !== password
  const invalid = errors.length > 0 || mismatch

  const inputProps = {
    id,
    name: attribute.name,
    autoComplete: attribute.autocomplete ?? autoComplete,
    placeholder,
    value,
    readOnly: attribute.readOnly,
    'aria-invalid': invalid,
    'aria-describedby': isConfirm ? `${id}-match` : undefined,
    onChange: (event: ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value),
    onBlur,
  }

  return (
    <Field data-invalid={invalid || undefined} className="gap-1.5">
      <Label htmlFor={id}>{attribute.required ? <RequiredLabel>{label}</RequiredLabel> : label}</Label>
      {type === 'password' ? (
        <PasswordInput {...inputProps} showLabel={showPasswordLabel} hideLabel={hidePasswordLabel} />
      ) : (
        <div className="relative">
          <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input {...inputProps} type={type} className="h-11 pl-9" />
        </div>
      )}
      {isConfirm ? <PasswordMatchHint id={`${id}-match`} password={password} confirm={value} /> : null}
      {errors.length > 0 ? <FieldError errors={errors.map((error) => ({ message: error.errorMessageStr }))} /> : null}
    </Field>
  )
}
