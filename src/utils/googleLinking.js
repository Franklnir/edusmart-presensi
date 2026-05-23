const GOOGLE_LINK_CONFIRM_RETRY_ATTEMPTS = 10
const GOOGLE_LINK_CONFIRM_RETRY_DELAY_MS = 650

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const isGoogleLinkedAccount = (user = {}, providerState = {}) => {
  const providers = [
    ...(Array.isArray(user?.providers) ? user.providers : []),
    ...(Array.isArray(user?.user_metadata?.providers) ? user.user_metadata.providers : []),
    ...(Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [])
  ].map((provider) => String(provider || '').trim().toLowerCase())

  return Boolean(
    user?.google_linked ||
    user?.google_linked_at ||
    user?.google_id ||
    user?.google_sub ||
    user?.user_metadata?.google_linked ||
    user?.user_metadata?.google_linked_at ||
    user?.app_metadata?.google_linked ||
    providerState?.googleLinked ||
    providers.includes('google')
  )
}

export const buildGoogleLinkUnconfirmedMessage = (expectedEmail = '') => {
  const email = String(expectedEmail || '').trim()
  const expected = email ? ` Email akun Anda saat ini: ${email}.` : ''

  return `Tautan Google belum berhasil dikonfirmasi.${expected} Pastikan akun Google yang dipilih sama dengan email akun EduSmart, lalu coba lagi.`
}

export const completeGoogleLinkOAuthFlow = async ({
  popupResult = {},
  googleLinked = false,
  markGoogleLinked,
  refreshAuthSession,
  refreshProfile,
  expectedEmail = ''
} = {}) => {
  if (googleLinked) {
    return { ok: true, alreadyLinked: true }
  }

  const popupClosed = Boolean(
    popupResult?.popupClosed ||
    popupResult?.status === 'popup_closed'
  )

  if (!popupClosed) {
    markGoogleLinked?.()
  }

  let lastResult = null
  for (let attempt = 0; attempt < GOOGLE_LINK_CONFIRM_RETRY_ATTEMPTS; attempt += 1) {
    lastResult = await refreshAuthSession?.({
      showErrorToast: false,
      logErrorOnFail: false,
      retryAttempts: 1,
      retryDelayMs: 0
    })

    if (isGoogleLinkedAccount(lastResult?.user)) {
      await refreshProfile?.()
      return {
        ok: true,
        user: lastResult.user,
        profile: lastResult.profile,
        confirmedAfterClose: popupClosed
      }
    }

    if (!popupClosed && attempt >= 1) {
      await refreshProfile?.()
      return {
        ok: true,
        user: lastResult?.user || null,
        profile: lastResult?.profile || null,
        optimistic: true
      }
    }

    if (attempt < GOOGLE_LINK_CONFIRM_RETRY_ATTEMPTS - 1) {
      await wait(GOOGLE_LINK_CONFIRM_RETRY_DELAY_MS)
    }
  }

  throw new Error(lastResult?.error || buildGoogleLinkUnconfirmedMessage(expectedEmail))
}
