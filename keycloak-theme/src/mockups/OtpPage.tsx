import { useState } from "react"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp"
import { AuthShell, PageHeading, SubmitButton } from "@/mockups/AuthShell"
import { mockUser } from "@/mockups/mock-data"

/**
 * OTP entry for the password reset flow. Structure follows the shadcn/ui
 * InputOTP "Form" example, restyled for the shared auth card.
 */
export function OtpPage() {
  const [code, setCode] = useState("294")

  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading
          title="Check your email"
          description={
            <>
              {"Enter the verification code we sent to your email address "}
              <span className="font-medium text-foreground">{mockUser.email}</span>.
            </>
          }
        />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label htmlFor="otp-verification" className="text-sm font-medium">
              Verification code
            </label>
            <Button type="button" variant="outline" size="xs">
              <RefreshCw />
              Resend Code
            </Button>
          </div>
          <InputOTP
            id="otp-verification"
            maxLength={6}
            pattern={REGEXP_ONLY_DIGITS}
            value={code}
            onChange={setCode}
          >
            <InputOTPGroup className="flex-1 *:data-[slot=input-otp-slot]:h-12 *:data-[slot=input-otp-slot]:flex-1 *:data-[slot=input-otp-slot]:text-xl">
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator className="mx-2" />
            <InputOTPGroup className="flex-1 *:data-[slot=input-otp-slot]:h-12 *:data-[slot=input-otp-slot]:flex-1 *:data-[slot=input-otp-slot]:text-xl">
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
          <p className="text-sm text-muted-foreground">
            <a href="#" className="underline underline-offset-4 hover:text-primary">
              I no longer have access to this email address.
            </a>
          </p>
        </div>
        <div className="space-y-2">
          <SubmitButton type="button" disabled={code.length < 6}>
            Verify
          </SubmitButton>
          <p className="text-center text-sm text-muted-foreground">
            {"Having trouble signing in? "}
            <a href="#" className="underline underline-offset-4 hover:text-primary">
              Contact support
            </a>
          </p>
        </div>
      </div>
    </AuthShell>
  )
}
