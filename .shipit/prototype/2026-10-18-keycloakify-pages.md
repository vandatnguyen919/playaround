# Prototype round: Keycloakify pages (2026-10-18)

## Question

Do the five Keycloakify pages, built with shadcn/ui primitives and Tailwind,
match the shadcnstudio "07" reference designs closely enough to be the visual
direction for the theme?

## References used

- Login: shadcnstudio login-page-07
- Register: shadcnstudio register-07
- Forgot password: shadcnstudio forgot-password-07
- Reset password: shadcnstudio reset-password-07
- OTP entry: shadcn/ui InputOTP "Form" example (ui.shadcn.com)

All five were fetched live, so no screenshots were needed in this folder.

## What was built

Static mockups in /keycloak-theme (Vite dev server, `npm run dev`):

- src/mockups/AuthShell.tsx: shared shell and fields
  (AuthShell, PageHeading, SocialButtons, OrDivider, EmailField, NameField,
  PasswordField, BackToLoginButton)
- src/mockups/LoginPage.tsx
- src/mockups/RegisterPage.tsx
- src/mockups/ForgotPasswordPage.tsx
- src/mockups/OtpPage.tsx
- src/mockups/ResetPasswordPage.tsx
- src/mockups/mock-data.ts: mock user values
- src/MockupsApp.tsx: page switcher (mockup chrome only, not part of the theme)

Stack: Vite + React + TypeScript, Tailwind v4, shadcn/ui base (Base UI) with
Card, Input, Button, Label, Checkbox, Separator, InputOTP, Field.
Mock data only. No Keycloak wiring.

## What it confirms

- The 07 block layout is reproducible with shadcn/ui primitives and Tailwind
  with no custom CSS beyond the shell glows.
- Long content holds up (long full name in the register field, product name in
  button labels).
- State behavior is clear: disabled submit until valid, inline mismatch and
  length errors, OTP partial entry with disabled Verify.

## Deliberate deviations from the references

- GitHub replaces Facebook in the social row (matches the project stack).
- OTP title is "Check your email" to fit the password reset flow. The rest
  follows the shadcn Form example (label + Resend Code, 3+3 slots, "I no
  longer have access to this email address.", "Verify", "Contact support").
- Forgot password, OTP, and reset use the same bordered card as login and
  register. The reference blocks differ slightly there. One card look keeps
  the demo feeling like one product.
- Button copy follows the reference pattern: "Sign in to
  authn-authz-playground" where the reference says "Sign in to Shadcn Studio".

## Open items

- src/App.tsx and src/App.css are unused Vite starter leftovers. Delete when
  the theme work starts.
- shadcn CLI 4.x notes for later: `init -b base` picks the Base UI library,
  `-p nova` picks the preset. `add` has no `-b` flag.
