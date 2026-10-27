import { useState } from "react"

import { ForgotPasswordPage } from "@/mockups/ForgotPasswordPage"
import { LoginPage } from "@/mockups/LoginPage"
import { RegisterPage } from "@/mockups/RegisterPage"
import { ResetPasswordPage } from "@/mockups/ResetPasswordPage"

const pages = [
  { id: "login", label: "Login", Component: LoginPage },
  { id: "register", label: "Register", Component: RegisterPage },
  { id: "forgot", label: "Forgot password", Component: ForgotPasswordPage },
  { id: "reset", label: "Reset password", Component: ResetPasswordPage },
] as const

/**
 * Preview shell for the static mockups. This switcher is mockup chrome only.
 * It is not part of the theme.
 */
export default function MockupsApp() {
  const [activeId, setActiveId] = useState<(typeof pages)[number]["id"]>("login")
  const active = pages.find((page) => page.id === activeId) ?? pages[0]

  return (
    <div>
      <nav className="fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-card/90 p-1 shadow-sm backdrop-blur">
        <span className="px-2 text-xs text-muted-foreground">Mockups</span>
        {pages.map((page) => (
          <button
            key={page.id}
            type="button"
            onClick={() => setActiveId(page.id)}
            className={
              page.id === activeId
                ? "rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                : "rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            }
          >
            {page.label}
          </button>
        ))}
      </nav>
      <active.Component />
    </div>
  )
}
