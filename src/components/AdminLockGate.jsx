// src/components/AdminLockGate.jsx
import React, { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/useAuthStore'
import { useUIStore } from '../store/useUIStore'
import PasswordInput from './PasswordInput'

const STORAGE_KEY = 'admin_lock_unlocked_v1'
const LOCK_EXPIRY_MS = 30 * 60 * 1000 // 30 menit

function PasswordModal({ isOpen, onClose, onConfirm, title = 'Konfirmasi Password', loading = false }) {
  const [password, setPassword] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (password.trim()) onConfirm(password)
  }

  const handleClose = () => {
    setPassword('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600 text-sm mb-4">
          Untuk melanjutkan, masukkan password akun admin Anda:
        </p>

        <form onSubmit={handleSubmit}>
          <PasswordInput
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-4"
            placeholder="Masukkan password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors duration-200"
              onClick={handleClose}
              disabled={loading}
            >
              Batal
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || !password.trim()}
            >
              {loading ? 'Memverifikasi...' : 'Konfirmasi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function AdminLockGate() {
  const { settings } = useAuthStore()
  const { pushToast } = useUIStore()
  const location = useLocation()
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const lockEnabled = Boolean(settings?.admin_lock_enabled)
  const bypassLock = location.pathname.startsWith('/admin/pengaturan')

  useEffect(() => {
    if (!lockEnabled) {
      setIsUnlocked(true)
      setModalOpen(false)
      try {
        sessionStorage.removeItem(STORAGE_KEY)
      } catch { }
      return
    }

    const unlocked = (() => {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY)
        if (!raw) return false
        const parsed = JSON.parse(raw)
        if (!parsed?.unlockedAt) return false
        // Cek apakah sudah expired (30 menit)
        const elapsed = Date.now() - parsed.unlockedAt
        if (elapsed > LOCK_EXPIRY_MS) {
          sessionStorage.removeItem(STORAGE_KEY)
          return false
        }
        return true
      } catch {
        return false
      }
    })()

    setIsUnlocked(unlocked)
    setModalOpen(!unlocked)
  }, [lockEnabled])

  const handleConfirm = async (password) => {
    setLoading(true)
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser()
      if (userErr) throw userErr
      if (!user?.email) throw new Error('User tidak ditemukan')

      const { error } = await supabase.auth.signInWithPassword({
        email: user.email,
        password
      })

      if (error) throw new Error('Password salah')

      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ unlockedAt: Date.now() }))
      } catch { }
      setIsUnlocked(true)
      setModalOpen(false)
      pushToast('success', 'Akses admin dibuka')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal verifikasi password')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setModalOpen(false)
  }

  if (bypassLock || !lockEnabled || isUnlocked) return <Outlet />

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <PasswordModal
        isOpen={modalOpen}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title="Akses Halaman Admin"
        loading={loading}
      />

      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 w-full max-w-md">
        <div className="flex items-center mb-4">
          <div className="p-3 bg-blue-100 rounded-xl mr-3">
            <span className="text-2xl">🔒</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Halaman Admin Terkunci</h1>
            <p className="text-gray-600 text-sm">
              Masukkan password admin untuk membuka akses halaman admin.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="w-full bg-blue-600 text-white py-2.5 px-4 rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 text-sm font-medium transition-all duration-200"
        >
          Masukkan Password
        </button>
      </div>
    </div>
  )
}
