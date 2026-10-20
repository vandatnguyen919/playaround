import { Suspense } from 'react'
import DefaultPage from 'keycloakify/login/DefaultPage'
import DefaultTemplate from 'keycloakify/login/Template'
import UserProfileFormFields from 'keycloakify/login/UserProfileFormFields'
import type { KcContext } from './KcContext'
import { useI18n } from './i18n'
import Login from './pages/Login'

export default function KcPage({ kcContext }: { kcContext: KcContext }) {
  const { i18n } = useI18n({ kcContext })

  return (
    <Suspense>
      {kcContext.pageId === 'login.ftl' ? (
        <Login kcContext={kcContext} i18n={i18n} />
      ) : (
        <DefaultPage
          kcContext={kcContext}
          i18n={i18n}
          Template={DefaultTemplate}
          doUseDefaultCss={true}
          UserProfileFormFields={UserProfileFormFields}
          doMakeUserConfirmPassword={true}
        />
      )}
    </Suspense>
  )
}
