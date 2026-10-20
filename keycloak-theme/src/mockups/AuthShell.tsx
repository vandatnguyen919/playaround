import { useState } from "react"
import type { ChangeEvent, ComponentProps, ReactNode } from "react"
import { ChevronLeft, Eye, EyeOff, Lock, Mail, User } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

/**
 * Shared page chrome for the Keycloakify mockups. Split layout per the
 * approved reference: dark silk wave panel on the left, auth form on the
 * right. Below lg the wave panel is hidden and the form centers.
 */
export function AuthShell({
  children,
  showBrand = true,
}: {
  children: ReactNode
  showBrand?: boolean
}) {
  return (
    <div className="grid min-h-svh w-full grid-cols-1 lg:grid-cols-2">
      <aside className="relative m-3 hidden overflow-hidden rounded-[1.5rem] bg-[#0a0d12] lg:block">
        <SilkWaves />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-10">
          <h2 className="max-w-md text-4xl font-black uppercase leading-[1.05] tracking-tight text-white xl:text-5xl">
            One cookie.
            <br />
            Zero tokens.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/75">
            Sign-in runs through the gateway. The browser only ever sees a
            session cookie. Access and refresh tokens stay on the server.
          </p>
        </div>
      </aside>
      <main className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          {showBrand ? (
            <a
              href="#"
              className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
              Back to the playground
            </a>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  )
}

/** Abstract, undulating silk / liquid metal waves for the left panel. */
function SilkWaves() {
  return (
    <>
      <style>{`
        @keyframes silk-drift {
          from { transform: translate3d(-1.5%, -1%, 0) scale(1.06); }
          to { transform: translate3d(1.5%, 1.5%, 0) scale(1.12); }
        }
        .silk-layer {
          transform-origin: center;
          animation: silk-drift 24s ease-in-out infinite alternate;
        }
        .silk-layer-slow {
          animation-duration: 38s;
        }
      `}</style>
      <svg
        viewBox="0 0 800 900"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id="silk-1" x1="0%" y1="0%" x2="100%" y2="60%">
            <stop offset="0%" stopColor="#0a0d12" />
            <stop offset="35%" stopColor="#39424f" />
            <stop offset="55%" stopColor="#aab4c2" />
            <stop offset="75%" stopColor="#2a323d" />
            <stop offset="100%" stopColor="#0b0f14" />
          </linearGradient>
          <linearGradient id="silk-2" x1="100%" y1="0%" x2="0%" y2="80%">
            <stop offset="0%" stopColor="#12161c" />
            <stop offset="40%" stopColor="#5c6673" />
            <stop offset="60%" stopColor="#cfd6df" />
            <stop offset="85%" stopColor="#1a2028" />
            <stop offset="100%" stopColor="#0a0d12" />
          </linearGradient>
          <linearGradient id="silk-3" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#0d1117" />
            <stop offset="45%" stopColor="#20262f" />
            <stop offset="70%" stopColor="#8e99a8" />
            <stop offset="100%" stopColor="#141a21" />
          </linearGradient>
          <radialGradient id="silk-sheen" cx="70%" cy="18%" r="65%">
            <stop offset="0%" stopColor="#dfe6ee" stopOpacity="0.5" />
            <stop offset="45%" stopColor="#97a2b1" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#0a0d12" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="800" height="900" fill="#0a0d12" />
        <g className="silk-layer silk-layer-slow">
          <path
            d="M-80,120 C180,-20 380,220 880,60 L880,320 C380,470 180,240 -80,380 Z"
            fill="url(#silk-1)"
          />
          <path
            d="M-80,300 C220,150 420,430 880,250 L880,520 C420,690 220,420 -80,560 Z"
            fill="url(#silk-2)"
            opacity="0.85"
          />
        </g>
        <g className="silk-layer">
          <path
            d="M-80,520 C200,380 440,650 880,470 L880,720 C440,880 200,620 -80,760 Z"
            fill="url(#silk-3)"
            opacity="0.9"
          />
          <path
            d="M-80,700 C240,580 460,820 880,660 L880,980 L-80,980 Z"
            fill="url(#silk-1)"
            opacity="0.75"
          />
        </g>
        <rect width="800" height="900" fill="url(#silk-sheen)" />
      </svg>
    </>
  )
}

export function RequiredLabel({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <span className="text-destructive">*</span>
    </>
  )
}

export function SubmitButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(
        "h-11 w-full bg-foreground text-background hover:bg-foreground/90",
        className
      )}
      {...props}
    />
  )
}

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="#4285F4"
        d="M23.64 12.2045c0-.6381-.0573-1.2518-.1636-1.8409H12v3.4814h6.5218c-.2809 1.5136-1.1345 2.7955-2.4164 3.6545v3.0382h3.9109c2.2882-2.1073 3.6237-5.2109 3.6237-8.9332z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2673 0 6.0055-1.0836 8.0073-2.9318l-3.9109-3.0382c-1.0836.7264-2.4709 1.1554-4.0964 1.1554-3.1527 0-5.8218-2.1291-6.7745-4.9909H1.2545v3.14C3.2455 21.2836 7.3091 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.2255 14.1945c-.24-.7264-.3764-1.5027-.3764-2.1945s.1364-1.4682.3764-2.1945v-3.14H1.2545C.4545 8.2227 0 10.0527 0 12s.4545 3.7773 1.2545 5.3345l3.971-3.14z"
      />
      <path
        fill="#EA4335"
        d="M12 4.7455c1.7782 0 3.3736.6109 4.6282 1.8136l3.4718-3.4718C17.9982 1.1891 15.2618 0 12 0 7.3091 0 3.2455 2.7164 1.2545 6.6655l3.971 3.14C6.1782 6.8745 8.8473 4.7455 12 4.7455z"
      />
    </svg>
  )
}

function GitHubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

export function SocialButtons() {
  return (
    <div className="space-y-3">
      <Button type="button" variant="outline" className="h-11 w-full gap-2">
        <GoogleIcon className="size-4" />
        Login with Google
      </Button>
      <Button type="button" variant="outline" className="h-11 w-full gap-2">
        <GitHubIcon className="size-4" />
        Login with GitHub
      </Button>
    </div>
  )
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3">
      <Separator className="flex-1" />
      <span className="text-xs text-muted-foreground">Or</span>
      <Separator className="flex-1" />
    </div>
  )
}

export function PageHeading({
  title,
  description,
}: {
  title: string
  description: ReactNode
}) {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-foreground/75">{description}</p>
    </div>
  )
}

type FieldShellProps = {
  id: string
  label?: ReactNode
}

export function EmailField({
  id,
  label,
  defaultValue,
}: FieldShellProps & { defaultValue?: string }) {
  return (
    <div className="space-y-1.5">
      {label ? (
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
      ) : null}
      <div className="relative">
        <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type="email"
          placeholder="Enter your email address"
          defaultValue={defaultValue}
          className="h-11 pl-9"
        />
      </div>
    </div>
  )
}

export function NameField({ id, label, defaultValue }: FieldShellProps & { defaultValue?: string }) {
  return (
    <div className="space-y-1.5">
      {label ? (
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
      ) : null}
      <div className="relative">
        <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          placeholder="Enter your name"
          defaultValue={defaultValue}
          className="h-11 pl-9"
        />
      </div>
    </div>
  )
}

export function PasswordField({
  id,
  label,
  initialValue = "",
  onValueChange,
}: FieldShellProps & {
  initialValue?: string
  onValueChange?: (value: string) => void
}) {
  const [show, setShow] = useState(false)
  const [value, setValue] = useState(initialValue)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setValue(event.target.value)
    onValueChange?.(event.target.value)
  }

  return (
    <div className="space-y-1.5">
      {label ? (
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
      ) : null}
      <div className="relative">
        <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type={show ? "text" : "password"}
          placeholder="••••••••••••••••"
          value={value}
          onChange={handleChange}
          className="h-11 pl-9 pr-10"
        />
        <button
          type="button"
          onClick={() => setShow((visible) => !visible)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          <span className="sr-only">{show ? "Hide password" : "Show password"}</span>
        </button>
      </div>
    </div>
  )
}

export function BackToLoginButton() {
  return (
    <Button type="button" variant="outline" className="h-11 w-full">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
        <path d="m12 19-7-7 7-7" />
        <path d="M19 12H5" />
      </svg>
      Back to login
    </Button>
  )
}
