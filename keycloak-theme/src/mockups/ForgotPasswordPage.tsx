import {
  AuthShell,
  BackToLoginButton,
  EmailField,
  PageHeading,
  RequiredLabel,
  SubmitButton,
} from "@/mockups/AuthShell"

export function ForgotPasswordPage() {
  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading
          title="Forgot Password?"
          description="No worries, we'll send you reset instructions."
        />
        <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
          <EmailField
            id="forgot-email"
            label={<RequiredLabel>Email address</RequiredLabel>}
          />
          <SubmitButton type="submit">Send Reset Link</SubmitButton>
          <BackToLoginButton />
        </form>
      </div>
    </AuthShell>
  )
}
