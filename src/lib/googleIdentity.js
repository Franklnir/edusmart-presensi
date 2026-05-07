const GOOGLE_IDENTITY_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

let googleIdentityScriptPromise = null

export const loadGoogleIdentityScript = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Identity hanya tersedia di browser.'))
  }

  if (window.google?.accounts?.id?.initialize) {
    return Promise.resolve(window.google)
  }

  if (!googleIdentityScriptPromise) {
    googleIdentityScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-google-identity="true"]')
      if (existing) {
        existing.addEventListener('load', () => resolve(window.google), { once: true })
        existing.addEventListener('error', () => reject(new Error('Gagal memuat Google Identity script.')), { once: true })
        return
      }

      const script = document.createElement('script')
      script.src = GOOGLE_IDENTITY_SCRIPT_SRC
      script.async = true
      script.defer = true
      script.dataset.googleIdentity = 'true'
      script.onload = () => resolve(window.google)
      script.onerror = () => reject(new Error('Gagal memuat Google Identity script.'))
      document.head.appendChild(script)
    })
  }

  return googleIdentityScriptPromise
}

export const initializeGoogleSignIn = ({
  clientId,
  callback
}) => {
  if (typeof window === 'undefined' || !window.google?.accounts?.id?.initialize) {
    throw new Error('Google Identity belum siap.')
  }

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback
  })
}

export const renderGoogleSignInButton = ({
  element,
  width = 320
}) => {
  if (typeof window === 'undefined' || !window.google?.accounts?.id?.renderButton) {
    throw new Error('Google Sign-In button belum siap.')
  }

  window.google.accounts.id.renderButton(element, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular',
    width,
    logo_alignment: 'left'
  })
}
