import { Checkbox } from "@/components/ui/checkbox"
import {
  AuthShell,
  EmailField,
  OrDivider,
  PageHeading,
  PasswordField,
  RequiredLabel,
  SocialButtons,
  SubmitButton,
} from "@/mockups/AuthShell"
import { mockUser, productName } from "@/mockups/mock-data"

export function LoginPage() {
  return (
    <AuthShell>
      <div className="space-y-6">
        <PageHeading
          title="Welcome Back 👋"
          description="Welcome back! Select a method to sign in"
        />
        <SocialButtons />
        <OrDivider />
        <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
          <EmailField
            id="login-email"
            label={<RequiredLabel>Email address</RequiredLabel>}
            defaultValue={mockUser.email}
          />
          <PasswordField
            id="login-password"
            label={<RequiredLabel>Password</RequiredLabel>}
          />
          <div className="flex items-center justify-between">
            <label htmlFor="login-remember" className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox id="login-remember" defaultChecked />
              Remember Me
            </label>
            <a
              href="#"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Forgot Password?
            </a>
          </div>
          <SubmitButton type="submit">Sign in to {productName}</SubmitButton>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          {"Don't have an account yet? "}
          <a href="#" className="font-medium text-foreground underline underline-offset-4">
            Sign Up
          </a>
        </p>
      </div>
    </AuthShell>
  )
}
