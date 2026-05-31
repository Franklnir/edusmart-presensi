import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, RotateCcw, Workflow, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { useAuthStore } from '../../store/useAuthStore'

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

/* ═══════════════════════════════════════════════
   Flow Data – EduSmart Process Flow
   ═══════════════════════════════════════════════ */
const FLOW_NODES = [
  // Authentication Layer
  { id: 'login',        x: 50,   y: 400, label: '🔐 Autentikasi',   color: '#8b5cf6' },
  { id: 'gateway',      x: 250,  y: 400, label: '🚦 Role Gateway',  color: '#6366f1' },

  // --- SISWA (Top path) ---
  { id: 'siswa_dash',   x: 450,  y: 100, label: '👨‍🎓 Dash Siswa',   color: '#0ea5e9' },
  { id: 'siswa_profil', x: 680,  y: 40,  label: '👤 Profil Siswa',  color: '#38bdf8' },
  { id: 'siswa_absen',  x: 680,  y: 100, label: '📋 Absensi',       color: '#0ea5e9' },
  { id: 'siswa_quiz',   x: 680,  y: 160, label: '🧠 Kerjakan Quiz', color: '#0ea5e9' },
  { id: 'siswa_tugas',  x: 680,  y: 220, label: '✏️ Kumpul Tugas',  color: '#0ea5e9' },

  // --- GURU (Middle path) ---
  { id: 'guru_dash',    x: 450,  y: 400, label: '👨‍🏫 Dash Guru',   color: '#10b981' },
  { id: 'guru_profil',  x: 680,  y: 280, label: '👤 Profil Guru',   color: '#34d399' },
  { id: 'guru_jadwal',  x: 680,  y: 340, label: '📅 Jadwal Ajar',   color: '#10b981' },
  { id: 'guru_absen',   x: 680,  y: 400, label: '✅ Cek Absensi',   color: '#10b981' },
  { id: 'guru_quiz',    x: 680,  y: 460, label: '📝 Buat Quiz',     color: '#10b981' },
  { id: 'guru_tugas',   x: 680,  y: 520, label: '📚 Buat Tugas',    color: '#10b981' },
  { id: 'guru_laporan', x: 680,  y: 580, label: '📊 Laporan Nilai', color: '#059669' },
  { id: 'guru_rapot',   x: 680,  y: 640, label: '🎓 Rapot (Wali)',  color: '#047857' },

  // --- ADMIN (Bottom path) ---
  { id: 'admin_dash',   x: 450,  y: 850, label: '💼 Dash Admin',    color: '#f59e0b' },
  { id: 'admin_sekolah',x: 680,  y: 730, label: '🏫 Kelola Kelas',  color: '#fbbf24' },
  { id: 'admin_users',  x: 680,  y: 790, label: '👥 Kelola Users',  color: '#fbbf24' },
  { id: 'admin_scan',   x: 680,  y: 850, label: '📱 Scan Absensi',  color: '#f59e0b' },
  { id: 'admin_sertif', x: 680,  y: 910, label: '🏆 Sertifikat',    color: '#d97706' },
  { id: 'admin_set',    x: 680,  y: 970, label: '⚙️ Pengaturan',    color: '#b45309' },
  { id: 'admin_wa',     x: 680,  y: 1030,label: '💬 WhatsApp',      color: '#b45309' },

  // --- SUPER ADMIN (Lowest path) ---
  { id: 'sa_dash',      x: 450,  y: 1240,label: '🛡️ Dash Super',    color: '#ef4444' },
  { id: 'sa_tenant',    x: 680,  y: 1120,label: '🏢 Kelola Tenants',color: '#f87171' },
  { id: 'sa_monitor',   x: 680,  y: 1180,label: '📈 Monitoring App',color: '#ef4444' },
  { id: 'sa_server',    x: 680,  y: 1240,label: '🖥️ Monitor Server',color: '#ef4444' },
  { id: 'sa_logs',      x: 680,  y: 1300,label: '📜 System Logs',   color: '#dc2626' },
  { id: 'sa_audit',     x: 680,  y: 1360,label: '🔍 Audit Trail',   color: '#b91c1c' },

  // --- INFRASTRUCTURE & STORAGE ---
  { id: 'db_main',      x: 950,  y: 600, label: '🗄️ Database',      color: '#64748b' },
  { id: 'storage',      x: 950,  y: 850, label: '☁️ S3 Storage',    color: '#64748b' },
  { id: 'backup',       x: 950,  y: 1000,label: '🔄 Auto Backup',   color: '#475569' },
  
  // --- OUTPUT ---
  { id: 'out_nilai',    x: 950,  y: 190, label: '💯 Nilai Keluar',  color: '#ec4899' },
  { id: 'out_lulus',    x: 1200, y: 550, label: '🌟 Lulus/Selesai', color: '#22c55e' },
]

const FLOW_EDGES = [
  // Auth flow
  { id: 'e_auth1', from: 'login', to: 'gateway' },

  // Gateway to Roles
  { id: 'e_gate_s', from: 'gateway', to: 'siswa_dash' },
  { id: 'e_gate_g', from: 'gateway', to: 'guru_dash' },
  { id: 'e_gate_a', from: 'gateway', to: 'admin_dash' },
  { id: 'e_gate_sa',from: 'gateway', to: 'sa_dash' },

  // Siswa features
  { id: 'e_s1', from: 'siswa_dash', to: 'siswa_profil' },
  { id: 'e_s2', from: 'siswa_dash', to: 'siswa_absen' },
  { id: 'e_s3', from: 'siswa_dash', to: 'siswa_quiz' },
  { id: 'e_s4', from: 'siswa_dash', to: 'siswa_tugas' },

  // Guru features
  { id: 'e_g1', from: 'guru_dash', to: 'guru_profil' },
  { id: 'e_g2', from: 'guru_dash', to: 'guru_jadwal' },
  { id: 'e_g3', from: 'guru_dash', to: 'guru_absen' },
  { id: 'e_g4', from: 'guru_dash', to: 'guru_quiz' },
  { id: 'e_g5', from: 'guru_dash', to: 'guru_tugas' },
  { id: 'e_g6', from: 'guru_dash', to: 'guru_laporan' },
  { id: 'e_g7', from: 'guru_dash', to: 'guru_rapot' },

  // Admin features
  { id: 'e_a1', from: 'admin_dash', to: 'admin_sekolah' },
  { id: 'e_a2', from: 'admin_dash', to: 'admin_users' },
  { id: 'e_a3', from: 'admin_dash', to: 'admin_scan' },
  { id: 'e_a4', from: 'admin_dash', to: 'admin_sertif' },
  { id: 'e_a5', from: 'admin_dash', to: 'admin_set' },
  { id: 'e_a6', from: 'admin_dash', to: 'admin_wa' },

  // Super Admin features
  { id: 'e_sa1', from: 'sa_dash', to: 'sa_tenant' },
  { id: 'e_sa2', from: 'sa_dash', to: 'sa_monitor' },
  { id: 'e_sa3', from: 'sa_dash', to: 'sa_server' },
  { id: 'e_sa4', from: 'sa_dash', to: 'sa_logs' },
  { id: 'e_sa5', from: 'sa_dash', to: 'sa_audit' },

  // Cross-role interactions
  { id: 'e_cross1', from: 'guru_quiz', to: 'siswa_quiz' },
  { id: 'e_cross2', from: 'guru_tugas', to: 'siswa_tugas' },
  { id: 'e_cross3', from: 'siswa_quiz', to: 'out_nilai' },
  { id: 'e_cross4', from: 'siswa_tugas', to: 'out_nilai' },
  { id: 'e_cross5', from: 'out_nilai', to: 'guru_laporan' },
  { id: 'e_cross6', from: 'guru_laporan', to: 'guru_rapot' },
  { id: 'e_cross7', from: 'admin_scan', to: 'siswa_absen' },
  { id: 'e_cross8', from: 'siswa_absen', to: 'guru_absen' },

  // Infrastructure links
  { id: 'e_db1', from: 'admin_users', to: 'db_main' },
  { id: 'e_db2', from: 'guru_laporan', to: 'db_main' },
  { id: 'e_st1', from: 'siswa_tugas', to: 'storage' },
  { id: 'e_st2', from: 'admin_sertif', to: 'storage' },
  { id: 'e_bk1', from: 'db_main', to: 'backup' },
  { id: 'e_bk2', from: 'admin_set', to: 'backup' },

  // Final outputs
  { id: 'e_end1', from: 'guru_rapot', to: 'out_lulus' },
  { id: 'e_end2', from: 'admin_sertif', to: 'out_lulus' },
]

const NODE_WIDTH = 150
const NODE_HEIGHT = 48

/* ═══════════════════════════════════════════════
   SVG Edge with animated dashes & gradient
   ═══════════════════════════════════════════════ */
function FlowEdge({ fromNode, toNode, index }) {
  const x1 = fromNode.x + NODE_WIDTH
  const y1 = fromNode.y + NODE_HEIGHT / 2
  const x2 = toNode.x
  const y2 = toNode.y + NODE_HEIGHT / 2

  const dx = x2 - x1
  const cpOffset = Math.max(60, Math.abs(dx) * 0.4)

  const d = `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`

  const gradId = `edge-grad-${index}`

  return (
    <g>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={fromNode.color} stopOpacity="0.7" />
          <stop offset="100%" stopColor={toNode.color} stopOpacity="0.7" />
        </linearGradient>
      </defs>
      {/* Glow effect */}
      <path
        d={d}
        fill="none"
        stroke={fromNode.color}
        strokeWidth="6"
        strokeOpacity="0.08"
        strokeLinecap="round"
      />
      {/* Main edge */}
      <path
        d={d}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="8 5"
        className="flow-edge-animated"
        style={{ animationDelay: `${index * 0.15}s` }}
      />
      {/* Animated particle dot */}
      <circle r="4" fill={toNode.color} opacity="0.9" className="flow-particle">
        <animateMotion
          dur={`${2.5 + index * 0.3}s`}
          repeatCount="indefinite"
          path={d}
        />
      </circle>
      <circle r="7" fill={toNode.color} opacity="0.2" className="flow-particle-glow">
        <animateMotion
          dur={`${2.5 + index * 0.3}s`}
          repeatCount="indefinite"
          path={d}
        />
      </circle>
    </g>
  )
}

/* ═══════════════════════════════════════════════
   Draggable Node
   ═══════════════════════════════════════════════ */
function FlowNode({ node, onDragStart, style }) {
  const handlePointerDown = useCallback((e) => {
    e.stopPropagation()
    onDragStart(node.id, e)
  }, [node.id, onDragStart])

  return (
    <div
      className="flow-node-card"
      style={{
        ...style,
        left: node.x,
        top: node.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        '--node-color': node.color,
      }}
      onPointerDown={handlePointerDown}
    >
      <div
        className="flow-node-indicator"
        style={{ background: node.color }}
      />
      <span className="flow-node-label">{node.label}</span>
      {/* Source handle (right) */}
      <div className="flow-handle flow-handle-right" style={{ background: node.color }} />
      {/* Target handle (left) */}
      <div className="flow-handle flow-handle-left" style={{ background: node.color }} />
    </div>
  )
}

/* ═══════════════════════════════════════════════
   Dot Grid Background
   ═══════════════════════════════════════════════ */
function DotBackground() {
  return (
    <svg className="absolute inset-0 h-full w-full" style={{ minWidth: 1600, minHeight: 1600 }}>
      <defs>
        <pattern id="dotPattern" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="rgba(148,163,184,0.12)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dotPattern)" />
    </svg>
  )
}

/* ═══════════════════════════════════════════════
   Main Canvas Component
   ═══════════════════════════════════════════════ */
function FlowCanvas() {
  const [nodes, setNodes] = useState(() => FLOW_NODES.map((n) => ({ ...n })))
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const dragRef = useRef(null)
  const panRef = useRef(null)
  const canvasRef = useRef(null)

  const nodeMap = useMemo(() => {
    const map = {}
    for (const node of nodes) map[node.id] = node
    return map
  }, [nodes])

  /* ── Node dragging ── */
  const handleNodeDragStart = useCallback((nodeId, e) => {
    const startX = e.clientX
    const startY = e.clientY
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return

    const origX = node.x
    const origY = node.y

    const onMove = (ev) => {
      const dx = (ev.clientX - startX) / transform.scale
      const dy = (ev.clientY - startY) / transform.scale
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, x: origX + dx, y: origY + dy } : n))
      )
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [nodes, transform.scale])

  /* ── Canvas panning ── */
  const handleCanvasPanStart = useCallback((e) => {
    if (e.target !== e.currentTarget && !e.target.closest('.flow-bg-layer')) return

    const startX = e.clientX
    const startY = e.clientY
    const origTx = transform.x
    const origTy = transform.y

    const onMove = (ev) => {
      setTransform((prev) => ({
        ...prev,
        x: origTx + (ev.clientX - startX),
        y: origTy + (ev.clientY - startY),
      }))
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [transform.x, transform.y])

  /* ── Zoom via scroll ── */
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return

    const handleWheel = (e) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.92 : 1.08
      setTransform((prev) => ({
        ...prev,
        scale: Math.max(0.3, Math.min(2.5, prev.scale * delta)),
      }))
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  /* ── Controls ── */
  const zoomIn = () => setTransform((p) => ({ ...p, scale: Math.min(2.5, p.scale * 1.2) }))
  const zoomOut = () => setTransform((p) => ({ ...p, scale: Math.max(0.3, p.scale / 1.2) }))
  const fitView = () => setTransform({ x: 0, y: 0, scale: 1 })
  const resetNodes = () => {
    setNodes(FLOW_NODES.map((n) => ({ ...n })))
    setTransform({ x: 0, y: 0, scale: 1 })
  }

  return (
    <div
      ref={canvasRef}
      className="relative h-full w-full overflow-hidden"
      style={{ minHeight: 560, cursor: 'grab', background: '#0a0f1e' }}
      onPointerDown={handleCanvasPanStart}
    >
      {/* Transform layer */}
      <div
        className="absolute flow-bg-layer"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: '0 0',
          width: 1600,
          height: 1600,
        }}
      >
        <DotBackground />

        {/* SVG Edges */}
        <svg
          className="absolute inset-0"
          style={{ width: 1600, height: 1600, overflow: 'visible' }}
        >
          {FLOW_EDGES.map((edge, i) => {
            const fromNode = nodeMap[edge.from]
            const toNode = nodeMap[edge.to]
            if (!fromNode || !toNode) return null
            return <FlowEdge key={edge.id} fromNode={fromNode} toNode={toNode} index={i} />
          })}
        </svg>

        {/* Nodes */}
        {nodes.map((node, i) => (
          <FlowNode
            key={node.id}
            node={node}
            onDragStart={handleNodeDragStart}
            style={{ animationDelay: `${i * 0.08}s` }}
          />
        ))}
      </div>

      {/* Legend overlay */}
      <div className="absolute left-4 top-4 z-10 rounded-xl bg-slate-900/80 px-4 py-3 backdrop-blur-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-violet-400">
          Alur Proses EduSmart
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Drag node · Scroll zoom · Drag canvas pan
        </p>
      </div>

      {/* Controls panel */}
      <div className="absolute bottom-4 left-4 z-10 flex gap-1.5 rounded-xl bg-slate-900/80 p-1.5 backdrop-blur-sm">
        <button
          type="button"
          onClick={zoomIn}
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 transition hover:bg-violet-500/20 hover:text-white"
          title="Zoom In"
        >
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          onClick={zoomOut}
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 transition hover:bg-violet-500/20 hover:text-white"
          title="Zoom Out"
        >
          <ZoomOut size={16} />
        </button>
        <button
          type="button"
          onClick={fitView}
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 transition hover:bg-violet-500/20 hover:text-white"
          title="Fit View"
        >
          <Maximize2 size={16} />
        </button>
      </div>

      {/* Mini-map */}
      <div className="absolute bottom-4 right-4 z-10 rounded-lg border border-violet-500/20 bg-slate-900/90 p-2 backdrop-blur-sm">
        <svg width="160" height="160" viewBox="0 0 1600 1600">
          {FLOW_EDGES.map((edge) => {
            const from = nodeMap[edge.from]
            const to = nodeMap[edge.to]
            if (!from || !to) return null
            return (
              <line
                key={`mm-${edge.id}`}
                x1={from.x + NODE_WIDTH / 2}
                y1={from.y + NODE_HEIGHT / 2}
                x2={to.x + NODE_WIDTH / 2}
                y2={to.y + NODE_HEIGHT / 2}
                stroke="rgba(139,92,246,0.3)"
                strokeWidth="8"
              />
            )
          })}
          {nodes.map((node) => (
            <rect
              key={`mm-${node.id}`}
              x={node.x}
              y={node.y}
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx="8"
              fill={node.color}
              opacity="0.6"
            />
          ))}
          {/* Viewport indicator */}
          <rect
            x={-transform.x / transform.scale}
            y={-transform.y / transform.scale}
            width={1026 / transform.scale}
            height={560 / transform.scale}
            fill="none"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="6"
            rx="4"
          />
        </svg>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   Main Page Component
   ═══════════════════════════════════════════════ */
export default function AnimasiFlow() {
  const { isSuperAdmin, superAdminChecked } = useAuthStore()

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
                  Visualisasi alur proses EduSmart dengan animasi flowchart interaktif — powered by ArtisanFlow concept.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Flow Canvas ── */}
        <div
          className="relative overflow-hidden rounded-2xl border border-slate-700/50 shadow-2xl"
          style={{ minHeight: 560 }}
        >
          <FlowCanvas />
        </div>

        {/* ── Info cards ── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <InfoCard emoji="🔐" title="Login" desc="Autentikasi pengguna melalui email atau Google OAuth" tone="violet" />
          <InfoCard emoji="🏠" title="Dashboard" desc="Pusat informasi dan navigasi utama untuk semua role" tone="indigo" />
          <InfoCard emoji="📋" title="Absensi & Quiz" desc="Pencatatan kehadiran dan evaluasi pembelajaran" tone="sky" />
          <InfoCard emoji="🏆" title="Sertifikat" desc="Penerbitan sertifikat dan laporan akhir" tone="emerald" />
        </div>

        {/* ── ArtisanFlow credit ── */}
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-slate-400">
          <Activity size={14} className="text-violet-400" />
          <span>
            Inspired by{' '}
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

      {/* Scoped CSS for flow canvas */}
      <style>{`
        .flow-node-card {
          position: absolute;
          display: flex;
          align-items: center;
          gap: 10px;
          background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
          border: 1.5px solid rgba(139, 92, 246, 0.35);
          border-radius: 14px;
          padding: 0 16px;
          color: #e2e8f0;
          box-shadow:
            0 4px 24px rgba(0,0,0,0.3),
            0 0 0 1px rgba(139, 92, 246, 0.06),
            inset 0 1px 0 rgba(255,255,255,0.04);
          cursor: grab;
          user-select: none;
          font-family: 'Inter', system-ui, sans-serif;
          transition: box-shadow 0.25s, border-color 0.25s, transform 0.18s;
          animation: nodeAppear 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
          z-index: 2;
        }
        .flow-node-card:hover {
          border-color: var(--node-color, rgba(139, 92, 246, 0.7));
          box-shadow:
            0 8px 32px rgba(139, 92, 246, 0.25),
            0 0 0 2px rgba(139, 92, 246, 0.12),
            inset 0 1px 0 rgba(255,255,255,0.06);
          transform: translateY(-2px);
          z-index: 10;
        }
        .flow-node-card:active {
          cursor: grabbing;
          transform: scale(1.03);
        }
        .flow-node-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
          animation: pulse-dot 2s ease-in-out infinite;
        }
        .flow-node-label {
          font-weight: 700;
          font-size: 13px;
          white-space: nowrap;
          letter-spacing: 0.01em;
        }
        .flow-handle {
          position: absolute;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: 2px solid #1e293b;
          top: 50%;
          transform: translateY(-50%);
          z-index: 3;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .flow-handle-left {
          left: -5px;
        }
        .flow-handle-right {
          right: -5px;
        }
        .flow-node-card:hover .flow-handle {
          transform: translateY(-50%) scale(1.3);
          box-shadow: 0 0 8px rgba(139, 92, 246, 0.5);
        }

        .flow-edge-animated {
          animation: dashFlow 1.8s linear infinite;
        }
        .flow-particle {
          filter: drop-shadow(0 0 3px currentColor);
        }
        .flow-particle-glow {
          filter: blur(2px);
        }

        @keyframes dashFlow {
          to { stroke-dashoffset: -26; }
        }
        @keyframes nodeAppear {
          from {
            opacity: 0;
            transform: translateY(16px) scale(0.92);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.7); }
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
