import { kcSanitize } from 'keycloakify/lib/kcSanitize'
import type { PageProps } from 'keycloakify/login/pages/PageProps'

import { buttonVariants } from '@/components/ui/button'
import { AuthShell, PageHeading } from '@/mockups/AuthShell'
import { maskEmail } from '../lib/maskEmail'
import type { KcContext } from '../KcContext'
import type { I18n } from '../i18n'

type StatusProps<Id extends KcContext['pageId']> = Omit<
  PageProps<Extract<KcContext, { pageId: Id }>, I18n>,
  'Template' | 'doUseDefaultCss' | 'classes'
>

const linkButtonClass = `${buttonVariants({ variant: 'outline' })} h-11 w-full`

function Html({ html }: { html: string }) {
  return <span dangerouslySetInnerHTML={{ __html: kcSanitize(html) }} />
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
  const title = messageHeader ? advancedMsgStr(messageHeader) : message.summary
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
