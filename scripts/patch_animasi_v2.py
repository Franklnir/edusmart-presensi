#!/usr/bin/env python3
"""
Patch AnimasiFlow.jsx:
1. Smooth panning via DOM ref (skip React re-render)
2. Theme toggle (dark/light) dropdown
3. will-change: transform for GPU acceleration
"""

TARGET = '/home/irsyad/Dokumen/edusmart-presensi-backup-vps-ready-20260430/src/pages/admin/AnimasiFlow.jsx'

with open(TARGET, 'r') as f:
    src = f.read()

# ── 1. FlowCanvas: add theme param + transformRef + applyTransform ────────────
src = src.replace(
    "function FlowCanvas() {\n  const [nodes, setNodes] = useState(() => FLOW_NODES.map((n) => ({ ...n })))\n  const [transform, setTransform] = useState({ x: 20, y: 20, scale: 0.55 })\n  const dragRef = useRef(null)\n  const panRef = useRef(null)\n  const canvasRef = useRef(null)",
    """function FlowCanvas({ theme = 'dark' }) {
  const [nodes, setNodes] = useState(() => FLOW_NODES.map((n) => ({ ...n })))
  const [transform, setTransform] = useState({ x: 20, y: 20, scale: 0.55 })
  const transformLayerRef = useRef(null)
  const transformRef = useRef({ x: 20, y: 20, scale: 0.55 })
  const canvasRef = useRef(null)

  /** Directly patch the DOM — no React re-render during pan/zoom */
  const applyTransform = useCallback((t) => {
    transformRef.current = t
    if (transformLayerRef.current) {
      transformLayerRef.current.style.transform =
        `translate(${t.x}px, ${t.y}px) scale(${t.scale})`
    }
  }, [])"""
)

# ── 2. Node drag: use transformRef.current.scale instead of transform.scale ───
src = src.replace(
    "const dx = (ev.clientX - startX) / transform.scale\n        const dy = (ev.clientY - startY) / transform.scale",
    "const dx = (ev.clientX - startX) / transformRef.current.scale\n        const dy = (ev.clientY - startY) / transformRef.current.scale"
)

# ── 3. Canvas pan: ref-based, setTransform only on pointerup ─────────────────
src = src.replace(
    """  /* ── Canvas panning ── */
  const handleCanvasPanStart = useCallback((e) => {
    if (e.target !== e.currentTarget && !e.target.closest('.flow-bg-layer')) return

    const startX = e.clientX
    const startY = e.clientY
    const origTx = transform.x
    const origTy = transform.y

    let frameId;
    const onMove = (ev) => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        setTransform((prev) => ({
          ...prev,
          x: origTx + (ev.clientX - startX),
          y: origTy + (ev.clientY - startY),
        }))
      });
    }

    const onUp = () => {
      if (frameId) cancelAnimationFrame(frameId);
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [transform.x, transform.y])""",
    """  /* ── Canvas panning (ref-based: no React re-render during drag) ── */
  const handleCanvasPanStart = useCallback((e) => {
    if (e.target !== e.currentTarget && !e.target.closest('.flow-bg-layer')) return

    const startX = e.clientX
    const startY = e.clientY
    const origTx = transformRef.current.x
    const origTy = transformRef.current.y

    let frameId
    const onMove = (ev) => {
      if (frameId) cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(() => {
        applyTransform({
          ...transformRef.current,
          x: origTx + (ev.clientX - startX),
          y: origTy + (ev.clientY - startY),
        })
      })
    }

    const onUp = () => {
      if (frameId) cancelAnimationFrame(frameId)
      setTransform({ ...transformRef.current }) // sync state for minimap
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [applyTransform])"""
)

# ── 4. Wheel zoom: use applyTransform + sync setTransform ────────────────────
src = src.replace(
    """    const handleWheel = (e) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.92 : 1.08
      setTransform((prev) => ({
        ...prev,
        scale: Math.max(0.3, Math.min(2.5, prev.scale * delta)),
      }))
    }""",
    """    const handleWheel = (e) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.92 : 1.08
      const newT = {
        ...transformRef.current,
        scale: Math.max(0.3, Math.min(2.5, transformRef.current.scale * delta)),
      }
      applyTransform(newT)
      setTransform({ ...newT })
    }"""
)

# Fix useEffect deps
src = src.replace("  }, [])\n\n  /* ── Controls ── */", "  }, [applyTransform])\n\n  /* ── Controls ── */")

# ── 5. Controls: update fitView/resetNodes to use applyTransform ─────────────
src = src.replace(
    "  const zoomIn = () => setTransform((p) => ({ ...p, scale: Math.min(2.5, p.scale * 1.2) }))\n  const zoomOut = () => setTransform((p) => ({ ...p, scale: Math.max(0.3, p.scale / 1.2) }))\n  const fitView = () => setTransform({ x: 20, y: 20, scale: 0.55 })\n  const resetNodes = () => {\n    setNodes(FLOW_NODES.map((n) => ({ ...n })))\n    setTransform({ x: 20, y: 20, scale: 0.55 })\n  }",
    """  const zoomIn = () => { const t = { ...transformRef.current, scale: Math.min(2.5, transformRef.current.scale * 1.2) }; applyTransform(t); setTransform({ ...t }) }
  const zoomOut = () => { const t = { ...transformRef.current, scale: Math.max(0.3, transformRef.current.scale / 1.2) }; applyTransform(t); setTransform({ ...t }) }
  const fitView = () => { const t = { x: 20, y: 20, scale: 0.55 }; applyTransform(t); setTransform({ ...t }) }
  const resetNodes = () => {
    setNodes(FLOW_NODES.map((n) => ({ ...n })))
    const t = { x: 20, y: 20, scale: 0.55 }
    applyTransform(t)
    setTransform({ ...t })
  }"""
)

# ── 6. Transform layer div: add ref + willChange ──────────────────────────────
src = src.replace(
    "        className=\"absolute flow-bg-layer\"\n          style={{\n            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,\n            transformOrigin: '0 0',\n            width: 1600,\n            height: 2000,\n          }}",
    """        ref={transformLayerRef}
          className="absolute flow-bg-layer"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
            width: 1600,
            height: 2000,
            willChange: 'transform',
          }}"""
)

# ── 7. Canvas background: theme-aware ────────────────────────────────────────
src = src.replace(
    "style={{ minHeight: 640, cursor: 'grab', background: '#0a0f1e' }}",
    "style={{ minHeight: 640, cursor: 'grab', background: theme === 'dark' ? '#0a0f1e' : '#e8edf5' }}"
)

# ── 8. Pass theme to FlowCanvas in AnimasiFlow ───────────────────────────────
src = src.replace(
    "          <FlowCanvas />",
    "          <FlowCanvas theme={theme} />"
)

# ── 9. AnimasiFlow: add theme state + dropdown in header ─────────────────────
src = src.replace(
    "export default function AnimasiFlow() {\n  const { isSuperAdmin, superAdminChecked } = useAuthStore()",
    """export default function AnimasiFlow() {
  const { isSuperAdmin, superAdminChecked } = useAuthStore()
  const [theme, setTheme] = useState('dark')
  const [themeOpen, setThemeOpen] = useState(false)"""
)

# Add theme dropdown button next to the header right side
src = src.replace(
    "            <div className=\"flex items-center gap-4\">",
    """            <div className="flex items-center gap-3 ml-auto relative">
              <button
                type="button"
                onClick={() => setThemeOpen((o) => !o)}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-violet-400 hover:text-violet-600"
                style={{ minWidth: 120 }}
              >
                <span>{theme === 'dark' ? '🌙' : '☀️'}</span>
                <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
                <span className="ml-auto opacity-50">▾</span>
              </button>
              {themeOpen && (
                <div className="absolute right-0 top-11 z-50 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                  {[
                    { value: 'dark', emoji: '🌙', label: 'Dark' },
                    { value: 'light', emoji: '☀️', label: 'Light' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setTheme(opt.value); setThemeOpen(false) }}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium transition hover:bg-violet-50 hover:text-violet-700 ${theme === opt.value ? 'bg-violet-50 text-violet-700' : 'text-slate-700'}`}
                    >
                      <span>{opt.emoji}</span>
                      <span>{opt.label}</span>
                      {theme === opt.value && <span className="ml-auto text-violet-500">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-4">""",
    1
)

# Close the extra div in the flex row (lg:justify-between)
src = src.replace(
    "          </div>\n        </div>\n      </div>\n\n        {/* ── Flow Canvas ── */}",
    "          </div>\n          </div>\n        </div>\n      </div>\n\n        {/* ── Flow Canvas ── */"
)

# ── 10. CSS: add light-theme overrides ───────────────────────────────────────
src = src.replace(
    "        @keyframes pulse-dot {",
    """        /* Light theme overrides */
        [data-flow-theme="light"] .flow-node-card {
          background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
          border-color: rgba(99, 102, 241, 0.25);
          color: #1e293b;
          box-shadow: 0 4px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(99,102,241,0.06);
        }
        [data-flow-theme="light"] .flow-node-card:hover {
          border-color: var(--node-color, rgba(99, 102, 241, 0.6));
          box-shadow: 0 8px 24px rgba(99,102,241,0.15), 0 0 0 2px rgba(99,102,241,0.1);
        }
        [data-flow-theme="light"] .flow-handle {
          border-color: #f8fafc;
        }

        @keyframes pulse-dot {"""
)

# ── 11. Add data-flow-theme attr to canvas container ─────────────────────────
src = src.replace(
    "          className=\"relative overflow-hidden rounded-2xl border border-slate-700/50 shadow-2xl\"\n          style={{ minHeight: 640 }}",
    "          className=\"relative overflow-hidden rounded-2xl border border-slate-700/50 shadow-2xl\"\n          data-flow-theme={theme}\n          style={{ minHeight: 640 }}"
)

with open(TARGET, 'w') as f:
    f.write(src)

print("✅ Patch v2 selesai!")
print("  - Smooth pan (DOM ref, no React re-render)")
print("  - will-change: transform (GPU acceleration)")
print("  - Theme toggle dropdown (dark/light)")
print("  - Light theme CSS overrides")
