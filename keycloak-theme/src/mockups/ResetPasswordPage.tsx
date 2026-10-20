import { useState } from "react"

import {
  AuthShell,
  BackToLoginButton,
  PageHeading,
  PasswordField,
  RequiredLabel,
  SubmitButton,
} from "@/mockups/AuthShell"

export function ResetPasswordPage() {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")

  const tooShort = password.length > 0 && password.length < 8
  const mismatch = confirm.length > 0 && confirm !== password
  const canSubmit = password.length >= 8 && confirm === password

  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading
          title="Set new password"
          description="Must be at least 8 characters."
        />
        <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
          <PasswordField
            id="reset-password"
            label={<RequiredLabel>Password</RequiredLabel>}
            onValueChange={setPassword}
          />
          <PasswordField
            id="reset-confirm"
            label={<RequiredLabel>Confirm password</RequiredLabel>}
            onValueChange={setConfirm}
          />
          {tooShort ? (
            <p className="text-sm text-destructive">Use at least 8 characters.</p>
          ) : null}
          {mismatch ? (
            <p className="text-sm text-destructive">Passwords do not match.</p>
          ) : null}
          <SubmitButton type="submit" disabled={!canSubmit}>
            Reset Password
          </SubmitButton>
          <BackToLoginButton />
        </form>
      </div>
    </AuthShell>
  )
}
