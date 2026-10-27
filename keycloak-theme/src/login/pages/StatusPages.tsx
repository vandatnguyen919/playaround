import { useEffect, useState } from 'react'
import { cn } from 'cn'
import { kcSanitize } from 'keycloakify/lib/kcSanitize'
import type { PageProps } from 'keycloakify/login/pages/PageProps'

import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthShell, PageHeading, SubmitButton } from '@/mockups/AuthShell'
import { maskEmail, maskEmails } from '../lib/maskEmail'
import type { KcContext } from '../KcContext'
import type { I18n } from '../i18n'

type StatusProps<Id extends KcContext['pageId']> = Omit<
  PageProps<Extract<KcContext, { pageId: Id }>, I18n>,
  'Template' | 'doUseDefaultCss' | 'classes'
>

// cn resolves conflicting utilities (border-transparent vs border-border) that a plain join would leave to CSS order.
const linkButtonClass = cn(buttonVariants({ variant: 'outline' }), 'h-11 w-full')
const primaryLinkClass = cn(buttonVariants(), 'h-11 w-full bg-foreground text-background hover:bg-foreground/90')

// Keycloak messages can carry an email address (account exists, link account); mask it before display.
function Html({ html }: { html: string }) {
  return <span dangerouslySetInnerHTML={{ __html: kcSanitize(maskEmails(html)) }} />
}

function Notice({ message }: { message?: { summary: string } }) {
  if (!message) return null
  return (
    <p role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm text-foreground">
      <Html html={message.summary} />
    </p>
  )
}

export function LoginVerifyEmail({ kcContext, i18n }: StatusProps<'login-verify-email.ftl'>) {
  const { msg } = i18n
  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading
          title="Check your email"
          description={msg('emailVerifyInstruction1', maskEmail(kcContext.user?.email ?? ''))}
        />
        <p className="text-sm text-muted-foreground">{msg('emailVerifyInstruction2')}</p>
        <a href={kcContext.url.loginAction} className={linkButtonClass}>
          {msg('doClickHere')} {msg('emailVerifyInstruction3')}
        </a>
      </div>
    </AuthShell>
  )
}

export function Info({ kcContext, i18n }: StatusProps<'info.ftl'>) {
  const { msg, advancedMsgStr } = i18n
  const { messageHeader, message, skipLink, pageRedirectUri, actionUri } = kcContext
  const title = maskEmails(messageHeader ? advancedMsgStr(messageHeader) : message.summary)
  const link = pageRedirectUri
    ? { href: pageRedirectUri, label: msg('backToApplication') }
    : actionUri
      ? { href: actionUri, label: msg('proceedWithAction') }
      : undefined

  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading title={title.replace(/<[^>]*>/g, '')} description={<Html html={message.summary} />} />
        {!skipLink && link ? (
          <a href={link.href} className={linkButtonClass}>
            {link.label}
          </a>
        ) : null}
      </div>
    </AuthShell>
  )
}

export function LoginPageExpired({ kcContext, i18n }: StatusProps<'login-page-expired.ftl'>) {
  const { msgStr } = i18n
  const { url } = kcContext
  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading
          title={msgStr('pageExpiredTitle')}
          description="This page was open too long. Start over, or pick up where you left off."
        />
        <div className="space-y-3">
          <a id="loginRestartLink" href={url.loginRestartFlowUrl} className={primaryLinkClass}>
            Restart login
          </a>
          <a id="loginContinueLink" href={url.loginAction} className={linkButtonClass}>
            Continue login
          </a>
        </div>
      </div>
    </AuthShell>
  )
}

export function ErrorPage({ kcContext, i18n }: StatusProps<'error.ftl'>) {
  const { msg, msgStr } = i18n
  const { message, client, skipLink } = kcContext
  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading title={msgStr('errorTitle')} description={<Html html={message.summary} />} />
        {!skipLink && client?.baseUrl ? (
          <a id="backToApplication" href={client.baseUrl} className={linkButtonClass}>
            {msg('backToApplication')}
          </a>
        ) : null}
      </div>
    </AuthShell>
  )
}

export function LoginIdpLinkConfirm({ kcContext, i18n }: StatusProps<'login-idp-link-confirm.ftl'>) {
  const { msg, msgStr } = i18n
  const { url, idpAlias, message } = kcContext
  return (
    <AuthShell showBrand={false}>
      <form action={url.loginAction} method="post" className="space-y-6">
        <PageHeading
          title={msgStr('confirmLinkIdpTitle')}
          description={message ? <Html html={message.summary} /> : null}
        />
        <div className="space-y-3">
          <SubmitButton type="submit" name="submitAction" id="linkAccount" value="linkAccount">
            {msg('confirmLinkIdpContinue', idpAlias)}
          </SubmitButton>
          <button
            type="submit"
            name="submitAction"
            id="updateProfile"
            value="updateProfile"
            className={linkButtonClass}
          >
            {msg('confirmLinkIdpReviewProfile')}
          </button>
        </div>
      </form>
    </AuthShell>
  )
}

export function LoginIdpLinkEmail({ kcContext, i18n }: StatusProps<'login-idp-link-email.ftl'>) {
  const { msg, msgStr } = i18n
  const { url, realm, brokerContext, idpAlias, message } = kcContext
  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading
          title={msgStr('emailLinkIdpTitle', idpAlias)}
          description={msg('emailLinkIdp1', idpAlias, maskEmail(brokerContext.username), realm.displayName)}
        />
        <Notice message={message} />
        <div className="space-y-3">
          <a href={url.loginAction} className={primaryLinkClass}>
            I verified the email, continue
          </a>
          <a href={url.loginAction} className={linkButtonClass}>
            Resend email
          </a>
        </div>
      </div>
    </AuthShell>
  )
}

export function LoginIdpLinkConfirmOverride({ kcContext, i18n }: StatusProps<'login-idp-link-confirm-override.ftl'>) {
  const { msg, msgStr } = i18n
  const { url, idpDisplayName, message } = kcContext
  return (
    <AuthShell showBrand={false}>
      <form action={url.loginAction} method="post" className="space-y-6">
        <PageHeading
          title={msgStr('confirmOverrideIdpTitle')}
          description={message ? <Html html={message.summary} /> : null}
        />
        <div className="space-y-3">
          <SubmitButton type="submit" name="submitAction" id="confirmOverride" value="confirmOverride">
            {msg('confirmOverrideIdpContinue', idpDisplayName)}
          </SubmitButton>
          <a id="loginRestartLink" href={url.loginRestartFlowUrl} className={linkButtonClass}>
            Restart login
          </a>
        </div>
      </form>
    </AuthShell>
  )
}

export function LinkIdpAction({ kcContext, i18n }: StatusProps<'link-idp-action.ftl'>) {
  const { msg, msgStr } = i18n
  const { url, idpDisplayName } = kcContext
  return (
    <AuthShell showBrand={false}>
      <form action={url.loginAction} method="post" className="space-y-6">
        <PageHeading
          title={msgStr('linkIdpActionTitle', idpDisplayName)}
          description={msg('linkIdpActionMessage', idpDisplayName)}
        />
        <div className="space-y-3">
          <SubmitButton type="submit" name="continue" id="kc-continue" value={msgStr('doContinue')}>
            {msg('doContinue')}
          </SubmitButton>
          <button type="submit" name="cancel-aia" id="kc-cancel" value={msgStr('doCancel')} className={linkButtonClass}>
            {msg('doCancel')}
          </button>
        </div>
      </form>
    </AuthShell>
  )
}

export function LogoutConfirm({ kcContext, i18n }: StatusProps<'logout-confirm.ftl'>) {
  const { msg, msgStr } = i18n
  const { url, client, logoutConfirm } = kcContext
  return (
    <AuthShell showBrand={false}>
      <form action={url.logoutConfirmAction} method="POST" className="space-y-6">
        <input type="hidden" name="session_code" value={logoutConfirm.code} />
        <PageHeading title={msgStr('logoutConfirmTitle')} description={msg('logoutConfirmHeader')} />
        <div className="space-y-3">
          <SubmitButton type="submit" name="confirmLogout" id="kc-logout" value={msgStr('doLogout')}>
            {msg('doLogout')}
          </SubmitButton>
          {!logoutConfirm.skipLink && client.baseUrl ? (
            <a href={client.baseUrl} className={linkButtonClass}>
              {msg('backToApplication')}
            </a>
          ) : null}
        </div>
      </form>
    </AuthShell>
  )
}

export function FrontchannelLogout({ kcContext, i18n }: StatusProps<'frontchannel-logout.ftl'>) {
  const { msg, msgStr } = i18n
  const { logout } = kcContext
  const [loaded, setLoaded] = useState(0)

  // Each client logs out in a hidden iframe; once all have loaded, follow the redirect.
  useEffect(() => {
    if (logout.logoutRedirectUri && loaded === logout.clients.length) {
      window.location.replace(logout.logoutRedirectUri)
    }
  }, [loaded, logout])

  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading title={msgStr('frontchannel-logout.title')} description={msg('frontchannel-logout.message')} />
        {logout.clients.length > 0 ? (
          <ul className="space-y-2 rounded-lg border px-4 py-3 text-sm">
            {logout.clients.map((client) => (
              <li key={client.name}>
                {client.name}
                <iframe
                  src={client.frontChannelLogoutUrl}
                  className="hidden"
                  title={client.name}
                  onLoad={() => setLoaded((count) => count + 1)}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {logout.logoutRedirectUri ? (
          <a id="continue" href={logout.logoutRedirectUri} className={primaryLinkClass}>
            {msg('doContinue')}
          </a>
        ) : null}
      </div>
    </AuthShell>
  )
}

export function Code({ kcContext, i18n }: StatusProps<'code.ftl'>) {
  const { msg, msgStr } = i18n
  const { code } = kcContext
  const [copied, setCopied] = useState(false)

  return (
    <AuthShell showBrand={false}>
      <div className="space-y-6">
        <PageHeading
          title={code.success ? msgStr('codeSuccessTitle') : msgStr('codeErrorTitle', code.error ?? '')}
          description={code.success ? msg('copyCodeInstruction') : code.error ? <Html html={code.error} /> : null}
        />
        {code.success && code.code ? (
          <div className="space-y-3">
            <Input id="code" readOnly value={code.code} className="h-11 font-mono" onFocus={(e) => e.target.select()} />
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              onClick={() => navigator.clipboard.writeText(code.code ?? '').then(() => setCopied(true))}
            >
              {copied ? 'Copied' : 'Copy code'}
            </Button>
          </div>
        ) : null}
      </div>
    </AuthShell>
  )
}

export function Terms({ kcContext, i18n }: StatusProps<'terms.ftl'>) {
  const { msg, msgStr } = i18n
  return (
    <AuthShell showBrand={false}>
      <form action={kcContext.url.loginAction} method="POST" className="space-y-6">
        <PageHeading title={msgStr('termsTitle')} description="Read and accept the terms to continue." />
        {msgStr('termsText') ? (
          <div id="kc-terms-text" className="max-h-64 overflow-y-auto rounded-lg border bg-muted/40 px-4 py-3 text-sm">
            {msg('termsText')}
          </div>
        ) : null}
        <div className="space-y-3">
          <SubmitButton type="submit" name="accept" id="kc-accept" value={msgStr('doAccept')}>
            {msg('doAccept')}
          </SubmitButton>
          <button type="submit" name="cancel" id="kc-decline" value={msgStr('doDecline')} className={linkButtonClass}>
            {msg('doDecline')}
          </button>
        </div>
      </form>
    </AuthShell>
  )
}

export function DeleteAccountConfirm({ kcContext, i18n }: StatusProps<'delete-account-confirm.ftl'>) {
  const { msg, msgStr } = i18n
  const { url, triggered_from_aia } = kcContext
  return (
    <AuthShell showBrand={false}>
      <form action={url.loginAction} method="post" className="space-y-6">
        <PageHeading title={msgStr('deleteAccountConfirm')} description={msg('irreversibleAction')} />
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <p>{msg('deletingImplies')}</p>
          <ul className="list-inside list-disc text-muted-foreground">
            <li>{msg('loggingOutImmediately')}</li>
            <li>{msg('errasingData')}</li>
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">{msg('finalDeletionConfirmation')}</p>
        <div className="space-y-3">
          <Button type="submit" className="h-11 w-full bg-destructive text-white hover:bg-destructive/90">
            {msg('doConfirmDelete')}
          </Button>
          {triggered_from_aia ? (
            <button type="submit" name="cancel-aia" value="true" className={linkButtonClass}>
              {msg('doCancel')}
            </button>
          ) : null}
        </div>
      </form>
    </AuthShell>
  )
}
