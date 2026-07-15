import React from 'react'
import { AlertTriangle, Copy, RefreshCw } from 'lucide-react'
import { getLastRequestId } from '../../lib/api/requestId'
import { logFrontendError } from '../../lib/api/client'

export default class AppErrorBoundary extends React.Component {
  state = { error: null, requestId: null }

  static getDerivedStateFromError(error) {
    return { error, requestId: getLastRequestId() }
  }

  componentDidCatch(error, info) {
    logFrontendError('critical', 'Unhandled React render error', {
      source: 'react-error-boundary',
      route: typeof window !== 'undefined' ? window.location.pathname : '',
      requestId: getLastRequestId(),
      error_name: String(error?.name || 'Error').slice(0, 120),
      component_stack: String(info?.componentStack || '').slice(0, 2000)
    })
  }

  copyRequestId = async () => {
    const requestId = this.state.requestId
    if (!requestId || typeof navigator === 'undefined' || !navigator.clipboard) return
    await navigator.clipboard.writeText(requestId).catch(() => {})
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-card">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-50 text-rose-600">
            <AlertTriangle size={28} />
          </span>
          <h1 className="mt-5 text-2xl font-black text-slate-950">Halaman mengalami kendala</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">Muat ulang halaman untuk melanjutkan. Detail teknis tidak ditampilkan demi keamanan.</p>
          {this.state.requestId ? (
            <button type="button" onClick={this.copyRequestId} className="mx-auto mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">
              <Copy size={14} /> Salin Request ID
            </button>
          ) : null}
          <button type="button" onClick={() => window.location.reload()} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white hover:bg-indigo-700">
            <RefreshCw size={16} /> Muat ulang
          </button>
        </section>
      </main>
    )
  }
}
