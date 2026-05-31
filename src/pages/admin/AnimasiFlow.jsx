import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Pause, Play, RotateCcw, Workflow } from 'lucide-react'
import { useAuthStore } from '../../store/useAuthStore'

/* ───────── CDN URLs ───────── */
const ALPINE_CDN = 'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js'
const ALPINEFLOW_CDN = 'https://cdn.jsdelivr.net/npm/@getartisanflow/alpineflow@latest/dist/alpineflow.bundle.umd.js'
const ALPINEFLOW_CSS = 'https://cdn.jsdelivr.net/npm/@getartisanflow/alpineflow@latest/css/alpineflow.css'
const ALPINEFLOW_THEME_CSS = 'https://cdn.jsdelivr.net/npm/@getartisanflow/alpineflow@latest/css/theme.css'

/* ───────── Super Admin Gate ───────── */
function PageGate({ superAdminChecked, isSuperAdmin, children }) {
  if (!superAdminChecked)
    return <div className="p-6 text-sm text-slate-500">Memuat akses super admin...</div>
  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Halaman ini hanya untuk super admin.
        </div>
      </div>
    )
  }
  return children
}

/* ────── Helper: load external script ────── */
function loadScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) {
      resolve(existing)
      return
    }
    const el = document.createElement('script')
    el.src = src
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error(`Failed to load script: ${src}`))
    document.head.appendChild(el)
  })
}

/* ────── Helper: load external CSS ────── */
function loadCSS(href) {
  if (document.querySelector(`link[href="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

/* ────────────────────────────────────────────────
   HTML template for the AlpineFlow canvas.
   This is injected into the isolated container.
   ──────────────────────────────────────────────── */
const buildFlowHTML = () => `
<div
  x-data="flowCanvas({
    nodes: [
      { id: 'login',      position: { x: 60,  y: 200 }, data: { label: '🔐 Login' } },
      { id: 'dashboard',  position: { x: 280, y: 120 }, data: { label: '🏠 Dashboard' } },
      { id: 'absensi',    position: { x: 500, y: 40  }, data: { label: '📋 Absensi' } },
      { id: 'quiz',       position: { x: 500, y: 200 }, data: { label: '🧠 Quiz' } },
      { id: 'tugas',      position: { x: 500, y: 360 }, data: { label: '✏️ Tugas' } },
      { id: 'laporan',    position: { x: 720, y: 120 }, data: { label: '📊 Laporan' } },
      { id: 'sertifikat', position: { x: 720, y: 300 }, data: { label: '🏆 Sertifikat' } },
      { id: 'selesai',    position: { x: 940, y: 200 }, data: { label: '✅ Selesai' } },
    ],
    edges: [
      { id: 'e1', source: 'login',     target: 'dashboard',  animated: true, type: 'smoothstep' },
      { id: 'e2', source: 'dashboard', target: 'absensi',    animated: true, type: 'bezier' },
      { id: 'e3', source: 'dashboard', target: 'quiz',       animated: true, type: 'bezier' },
      { id: 'e4', source: 'dashboard', target: 'tugas',      animated: true, type: 'bezier' },
      { id: 'e5', source: 'absensi',   target: 'laporan',    animated: true, type: 'smoothstep' },
      { id: 'e6', source: 'quiz',      target: 'laporan',    animated: true, type: 'smoothstep' },
      { id: 'e7', source: 'tugas',     target: 'sertifikat', animated: true, type: 'smoothstep' },
      { id: 'e8', source: 'laporan',   target: 'selesai',    animated: true, type: 'bezier' },
      { id: 'e9', source: 'sertifikat',target: 'selesai',    animated: true, type: 'bezier' },
    ],
    background: 'dots',
    fitViewOnInit: true,
    controls: true,
    minimap: true,
  })"
  class="flow-container"
  style="width:100%; height:100%; min-height:520px;"
>
  <div x-flow-viewport>
    <template x-for="node in nodes" :key="node.id">
      <div x-flow-node="node" class="af-node-custom">
        <div x-flow-handle:target></div>
        <span x-text="node.data.label" style="font-weight:700; font-size:14px; white-space:nowrap;"></span>
        <div x-flow-handle:source></div>
      </div>
    </template>
  </div>
</div>
`

/* ═══════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════ */
export default function AnimasiFlow() {
  const { isSuperAdmin, superAdminChecked } = useAuthStore()
  const containerRef = useRef(null)
  const alpineStartedRef = useRef(false)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [errorMsg, setErrorMsg] = useState('')

  /* ── Initialise Alpine + AlpineFlow inside the container ── */
  const initAlpineFlow = useCallback(async () => {
    try {
      setStatus('loading')

      // Load CSS
      loadCSS(ALPINEFLOW_CSS)
      loadCSS(ALPINEFLOW_THEME_CSS)

      // Load AlpineFlow first (it registers itself), then Alpine
      await loadScript(ALPINEFLOW_CDN)

      // Small delay to let AlpineFlow register
      await new Promise((r) => setTimeout(r, 150))

      // Inject HTML before Alpine starts
      if (containerRef.current) {
        containerRef.current.innerHTML = buildFlowHTML()
      }

      // Load & start Alpine if not already started
      if (!window.Alpine || !alpineStartedRef.current) {
        await loadScript(ALPINE_CDN, { defer: '' })
        // Wait for Alpine to be available
        await new Promise((resolve) => {
          const check = () => {
            if (window.Alpine) {
              resolve()
            } else {
              setTimeout(check, 50)
            }
          }
          check()
        })
      }

      // If Alpine hasn't been started yet on our container, init it
      if (containerRef.current && window.Alpine) {
        // Ensure AlpineFlow plugin is registered
        if (window.AlpineFlow) {
          window.Alpine.plugin(window.AlpineFlow)
        }

        if (!alpineStartedRef.current) {
          window.Alpine.start()
          alpineStartedRef.current = true
        } else {
          // Re-init the tree if Alpine was already started
          window.Alpine.initTree(containerRef.current)
        }
      }

      setStatus('ready')
    } catch (err) {
      console.error('AnimasiFlow init error:', err)
      setErrorMsg(err?.message || 'Gagal memuat animasi flow')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    if (!superAdminChecked || !isSuperAdmin) return

    initAlpineFlow()

    return () => {
      // Cleanup: destroy Alpine tree from our container
      if (containerRef.current && window.Alpine) {
        try {
          window.Alpine.destroyTree(containerRef.current)
        } catch {
          // silent
        }
        containerRef.current.innerHTML = ''
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [superAdminChecked, isSuperAdmin])

  /* ── Control handlers ── */
  const handleReset = useCallback(() => {
    if (containerRef.current && window.Alpine) {
      try {
        window.Alpine.destroyTree(containerRef.current)
      } catch {
        // silent
      }
      containerRef.current.innerHTML = ''
      alpineStartedRef.current = false
    }
    initAlpineFlow()
  }, [initAlpineFlow])

  return (
    <PageGate superAdminChecked={superAdminChecked} isSuperAdmin={isSuperAdmin}>
      <div className="space-y-6 p-4 sm:p-6">
        {/* ── Header ── */}
        <div className="page-title-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg">
                <Workflow size={24} />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">
                  Monitoring
                </p>
                <h1 className="page-title-heading">Animasi Flow</h1>
                <p className="page-title-description">
                  Visualisasi alur proses EduSmart dengan animasi flowchart interaktif menggunakan ArtisanFlow.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <RotateCcw size={16} />
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* ── Status messages ── */}
        {status === 'loading' && (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-100 bg-white p-10 shadow-card">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
            <span className="text-sm font-semibold text-slate-500">Memuat ArtisanFlow engine...</span>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            <p className="font-bold">Gagal memuat animasi</p>
            <p className="mt-1 text-red-600">{errorMsg}</p>
            <button
              type="button"
              onClick={handleReset}
              className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700"
            >
              Coba Lagi
            </button>
          </div>
        )}

        {/* ── Flow Canvas Container ── */}
        <div
          className="relative overflow-hidden rounded-2xl border border-slate-100 bg-slate-950 shadow-card"
          style={{ minHeight: 560 }}
        >
          {/* Legend overlay */}
          <div className="absolute left-4 top-4 z-10 rounded-xl bg-slate-900/80 px-4 py-3 backdrop-blur-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-violet-400">
              Alur Proses EduSmart
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Drag node · Scroll untuk zoom · Drag canvas untuk pan
            </p>
          </div>

          {/* Alpine.js + AlpineFlow isolated container */}
          <div
            ref={containerRef}
            id="alpineflow-container"
            className="h-full w-full"
            style={{ minHeight: 560 }}
          />
        </div>

        {/* ── Info cards ── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <InfoCard
            emoji="🔐"
            title="Login"
            desc="Autentikasi pengguna melalui email atau Google OAuth"
            tone="violet"
          />
          <InfoCard
            emoji="🏠"
            title="Dashboard"
            desc="Pusat informasi dan navigasi utama untuk semua role"
            tone="indigo"
          />
          <InfoCard
            emoji="📋"
            title="Absensi & Quiz"
            desc="Pencatatan kehadiran dan evaluasi pembelajaran"
            tone="sky"
          />
          <InfoCard
            emoji="🏆"
            title="Sertifikat"
            desc="Penerbitan sertifikat dan laporan akhir"
            tone="emerald"
          />
        </div>

        {/* ── ArtisanFlow credit ── */}
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-slate-400">
          <Activity size={14} className="text-violet-400" />
          <span>
            Powered by{' '}
            <a
              href="https://artisanflow.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-violet-400 transition hover:text-violet-300"
            >
              ArtisanFlow
            </a>
            {' '}— The flowchart engine for Alpine.js
          </span>
        </div>
      </div>

      {/* Scoped overrides for dark-themed flow canvas */}
      <style>{`
        #alpineflow-container .flow-container {
          background: #0f172a;
          border-radius: 1rem;
        }
        #alpineflow-container .flow-node,
        #alpineflow-container .af-node-custom {
          background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
          border: 1.5px solid rgba(139, 92, 246, 0.4);
          border-radius: 12px;
          padding: 10px 18px;
          color: #e2e8f0;
          box-shadow: 0 4px 20px rgba(139, 92, 246, 0.15), 0 0 0 1px rgba(139, 92, 246, 0.08);
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: grab;
          font-family: 'Inter', system-ui, sans-serif;
        }
        #alpineflow-container .flow-node:hover,
        #alpineflow-container .af-node-custom:hover {
          border-color: rgba(139, 92, 246, 0.7);
          box-shadow: 0 8px 32px rgba(139, 92, 246, 0.3), 0 0 0 2px rgba(139, 92, 246, 0.15);
          transform: translateY(-1px);
        }
        #alpineflow-container .flow-handle {
          width: 10px;
          height: 10px;
          background: #8b5cf6;
          border: 2px solid #1e293b;
          border-radius: 50%;
        }
        #alpineflow-container .flow-edge-path {
          stroke: rgba(139, 92, 246, 0.6);
          stroke-width: 2;
        }
        #alpineflow-container .flow-edge-path.animated {
          stroke-dasharray: 8 4;
          animation: flowDash 1.2s linear infinite;
        }
        #alpineflow-container .flow-background {
          color: rgba(148, 163, 184, 0.08);
        }
        #alpineflow-container .flow-minimap {
          background: rgba(15, 23, 42, 0.9);
          border: 1px solid rgba(139, 92, 246, 0.3);
          border-radius: 8px;
        }
        #alpineflow-container .flow-controls {
          background: rgba(30, 41, 59, 0.9);
          border: 1px solid rgba(139, 92, 246, 0.3);
          border-radius: 10px;
          backdrop-filter: blur(8px);
        }
        #alpineflow-container .flow-controls button {
          color: #e2e8f0;
        }
        #alpineflow-container .flow-controls button:hover {
          background: rgba(139, 92, 246, 0.2);
        }
        @keyframes flowDash {
          to { stroke-dashoffset: -24; }
        }
      `}</style>
    </PageGate>
  )
}

/* ── Small info card ── */
function InfoCard({ emoji, title, desc, tone = 'violet' }) {
  const toneMap = {
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    sky: 'bg-sky-50 text-sky-700 border-sky-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  }
  const cls = toneMap[tone] || toneMap.violet

  return (
    <div className={`rounded-2xl border p-5 shadow-card ${cls}`}>
      <div className="mb-2 text-2xl">{emoji}</div>
      <h3 className="text-sm font-extrabold">{title}</h3>
      <p className="mt-1 text-xs opacity-80">{desc}</p>
    </div>
  )
}
