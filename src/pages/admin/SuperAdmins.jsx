import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'
import PasswordInput from '../../components/PasswordInput'

const isValidEmail = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())
const isValidSlug = (value = '') => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(String(value).trim())

const getRootDomain = () => {
  const configured = import.meta.env.VITE_ROOT_DOMAIN
  if (configured) return configured
  if (typeof window === 'undefined') return ''
  return window.location.hostname || ''
}

const SuperAdmins = () => {
  const { isSuperAdmin, superAdminChecked } = useAuthStore()
  const { pushToast } = useUIStore()

  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const [form, setForm] = useState({
    email: '',
    name: '',
    password: '',
    tenantSlug: ''
  })

  const rootDomain = useMemo(() => getRootDomain(), [])
  const tenantPreview =
    form.tenantSlug && rootDomain ? `${form.tenantSlug}.${rootDomain}` : ''
  const filteredAdmins = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return admins
    return admins.filter((admin) => {
      const haystack = [
        admin.name,
        admin.user_name,
        admin.email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(keyword)
    })
  }, [admins, search])

  const loadAdmins = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.super.admins()
      if (error) throw error
      setAdmins(Array.isArray(data) ? data : [])
    } catch (err) {
      pushToast('error', err?.message || 'Gagal memuat daftar super admin')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!superAdminChecked || !isSuperAdmin) return
    loadAdmins()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [superAdminChecked, isSuperAdmin])

  const handleChange = (field) => (e) => {
    const value = e.target.value
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const resetForm = () => {
    setForm({
      email: '',
      name: '',
      password: '',
      tenantSlug: ''
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (saving) return

    const email = form.email.trim()
    const tenantSlug = form.tenantSlug.trim()

    if (!email) {
      pushToast('error', 'Email wajib diisi')
      return
    }
    if (!isValidEmail(email)) {
      pushToast('error', 'Format email tidak valid')
      return
    }
    if (form.password && form.password.length < 6) {
      pushToast('error', 'Password minimal 6 karakter')
      return
    }
    if (tenantSlug && !isValidSlug(tenantSlug)) {
      pushToast('error', 'Subdomain tidak valid')
      return
    }

    setSaving(true)
    try {
      const payload = {
        email,
        name: form.name.trim(),
        password: form.password || undefined,
        tenant_slug: tenantSlug || undefined
      }
      const { data, error } = await supabase.super.createAdmin(payload)
      if (error) throw error

      pushToast('success', 'Super admin berhasil ditambahkan')
      resetForm()
      await loadAdmins()

      if (data?.email) {
        pushToast('info', `Super admin: ${data.email}`)
      }
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menambahkan super admin')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!id) return
    const confirmed = window.confirm('Hapus super admin ini?')
    if (!confirmed) return

    try {
      const { error } = await supabase.super.deleteAdmin(id)
      if (error) throw error
      pushToast('success', 'Super admin dihapus')
      await loadAdmins()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menghapus super admin')
    }
  }

  if (!superAdminChecked) {
    return (
      <div className="p-6">
        <div className="text-sm text-slate-500">Memuat akses super admin...</div>
      </div>
    )
  }

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-slate-900">Akses ditolak</h2>
          <p className="text-sm text-slate-600 mt-2">
            Halaman ini khusus untuk Super Admin.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Super Admin Management</h1>
        <p className="text-sm text-slate-600">
          Tambah atau hapus super admin dengan aman.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Tambah Super Admin</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={handleChange('email')}
              placeholder="super@domain.com"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Nama</label>
            <input
              type="text"
              value={form.name}
              onChange={handleChange('name')}
              placeholder="Nama admin"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Password</label>
            <PasswordInput
              value={form.password}
              onChange={handleChange('password')}
              placeholder="Wajib untuk user baru"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-500">Kosongkan jika user sudah ada.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Tenant (opsional)</label>
            <input
              type="text"
              value={form.tenantSlug}
              onChange={handleChange('tenantSlug')}
              placeholder="default"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {tenantPreview && (
              <p className="text-xs text-slate-500">
                Tenant: <span className="font-semibold">{tenantPreview}</span>
              </p>
            )}
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={saving}
              className="w-full md:w-auto px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Menyimpan...' : 'Tambah Super Admin'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Daftar Super Admin</h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama/email..."
              className="hidden md:block text-xs px-3 py-1.5 rounded-full border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={loadAdmins}
              className="text-xs px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="md:hidden mb-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama/email..."
            className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">Memuat data super admin...</div>
        ) : admins.length === 0 ? (
          <div className="text-sm text-slate-500">Belum ada super admin.</div>
        ) : filteredAdmins.length === 0 ? (
          <div className="text-sm text-slate-500">Tidak ada hasil pencarian.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 pr-4">Nama</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Dibuat</th>
                  <th className="py-2 pr-4">Aksi</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {filteredAdmins.map((admin) => (
                  <tr key={admin.id} className="border-t border-slate-100">
                    <td className="py-2 pr-4 font-semibold text-slate-900">
                      {admin.name || admin.user_name || '-'}
                    </td>
                    <td className="py-2 pr-4">{admin.email || '-'}</td>
                    <td className="py-2 pr-4 text-slate-500">
                      {formatDateTime(admin.created_at)}
                    </td>
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        onClick={() => handleDelete(admin.id)}
                        className="text-xs px-3 py-1.5 rounded-full border border-rose-200 text-rose-600 hover:bg-rose-50"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default SuperAdmins
