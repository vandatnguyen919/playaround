import { Suspense } from 'react'
import DefaultPage from 'keycloakify/login/DefaultPage'
import DefaultTemplate from 'keycloakify/login/Template'
import UserProfileFormFields from 'keycloakify/login/UserProfileFormFields'
import type { KcContext } from './KcContext'
import { useI18n } from './i18n'
import IdpReviewUserProfile from './pages/IdpReviewUserProfile'
import Login from './pages/Login'
import LoginUpdateProfile from './pages/LoginUpdateProfile'
import LoginUpdatePassword from './pages/LoginUpdatePassword'
import LoginResetPassword from './pages/LoginResetPassword'
import Register from './pages/Register'
import {
  Code,
  DeleteAccountConfirm,
  ErrorPage,
  FrontchannelLogout,
  Info,
  LinkIdpAction,
  LoginIdpLinkConfirm,
  LoginIdpLinkConfirmOverride,
  LoginIdpLinkEmail,
  LoginPageExpired,
  LoginVerifyEmail,
  LogoutConfirm,
  Terms,
} from './pages/StatusPages'

export default function KcPage({ kcContext }: { kcContext: KcContext }) {
  const { i18n } = useI18n({ kcContext })

  return (
    <Suspense>
      {kcContext.pageId === 'login.ftl' ? (
        <Login kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'login-reset-password.ftl' ? (
        <LoginResetPassword kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'login-update-password.ftl' ? (
        <LoginUpdatePassword kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'login-update-profile.ftl' ? (
        <LoginUpdateProfile kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'idp-review-user-profile.ftl' ? (
        <IdpReviewUserProfile kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'register.ftl' ? (
        <Register kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'login-verify-email.ftl' ? (
        <LoginVerifyEmail kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'info.ftl' ? (
        <Info kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'login-page-expired.ftl' ? (
        <LoginPageExpired kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'error.ftl' ? (
        <ErrorPage kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'login-idp-link-confirm.ftl' ? (
        <LoginIdpLinkConfirm kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'login-idp-link-confirm-override.ftl' ? (
        <LoginIdpLinkConfirmOverride kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'login-idp-link-email.ftl' ? (
        <LoginIdpLinkEmail kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'link-idp-action.ftl' ? (
        <LinkIdpAction kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'logout-confirm.ftl' ? (
        <LogoutConfirm kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'frontchannel-logout.ftl' ? (
        <FrontchannelLogout kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'code.ftl' ? (
        <Code kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'terms.ftl' ? (
        <Terms kcContext={kcContext} i18n={i18n} />
      ) : kcContext.pageId === 'delete-account-confirm.ftl' ? (
        <DeleteAccountConfirm kcContext={kcContext} i18n={i18n} />
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
