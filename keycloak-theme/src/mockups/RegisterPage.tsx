import { Checkbox } from "@/components/ui/checkbox"
import {
  AuthShell,
  EmailField,
  NameField,
  OrDivider,
  PageHeading,
  PasswordField,
  RequiredLabel,
  SocialButtons,
  SubmitButton,
} from "@/mockups/AuthShell"
import { mockUser, productName } from "@/mockups/mock-data"

export function RegisterPage() {
  return (
    <AuthShell>
      <div className="space-y-6">
        <PageHeading
          title="Create your account"
          description="Sign up to unlock the full playground"
        />
        <SocialButtons />
        <OrDivider />
        <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
          <NameField
            id="register-name"
            label={<RequiredLabel>Name</RequiredLabel>}
            defaultValue={mockUser.fullName}
          />
          <EmailField
            id="register-email"
            label={<RequiredLabel>Email address</RequiredLabel>}
            defaultValue={mockUser.email}
          />
          <PasswordField
            id="register-password"
            label={<RequiredLabel>Password</RequiredLabel>}
          />
          <label htmlFor="register-terms" className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox id="register-terms" className="mt-0.5" />
            <span>
              {"I agree to all "}
              <a href="#" className="font-medium text-primary underline-offset-4 hover:underline">
                Terms, Privacy Policy and Fees
              </a>
            </span>
          </label>
          <SubmitButton type="submit">Sign up to {productName}</SubmitButton>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          {"Already have an account? "}
          <a href="#" className="font-medium text-foreground underline underline-offset-4">
            Log In
          </a>
        </p>
      </div>
    </AuthShell>
  )
}
