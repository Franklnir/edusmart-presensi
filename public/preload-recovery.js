window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('vite-reload-fallback')) {
    sessionStorage.setItem('vite-reload-fallback', 'true')
    window.location.reload()
  }
})

window.addEventListener('load', () => {
  sessionStorage.removeItem('vite-reload-fallback')
})
