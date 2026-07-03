import React, { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Eye,
  Plus,
  RefreshCw,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Trash2,
  UserPlus,
  X
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { ADMIN_FEATURES } from '../../constants/adminFeaturePermissions'

const TARGET_TYPE_LABELS = {
  teacher: 'Nama Guru',
  position: 'Jabatan',
  homeroom: 'Wali Kelas',
}

const initialForm = {
  target_type: 'teacher',
  teacher_id: '',
  position_id: '',
  class_id: '',
  features: [],
  is_active: true,
}

const statCardClass = 'min-h-[136px] rounded-2xl border border-slate-100 bg-white p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover'
const formControlClass = 'h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-900 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100'
const actionButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60'

const Badge = ({ children, active = true }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${
    active
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-slate-200 bg-slate-50 text-slate-500'
  }`}>
    {children}
  </span>
)

const PermissionAdmin = () => {
  const { pushToast } = useUIStore()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState({ rows: [], groups: [], options: {}, features: ADMIN_FEATURES })
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(initialForm)
  const { user, profile } = useAuthStore()
  const [adminList, setAdminList] = useState([])

  const groups = Array.isArray(data?.groups) ? data.groups : []
  const options = data?.options || {}
  const teachers = Array.isArray(options?.teachers) ? options.teachers : []
  const positions = Array.isArray(options?.positions) ? options.positions : []
  const homerooms = Array.isArray(options?.homerooms) ? options.homerooms : []
  const activeTotal = groups.reduce((sum, item) => sum + Number(item.active_count || 0), 0)
  const inactiveTotal = groups.reduce((sum, item) => sum + Number(item.inactive_count || 0), 0)

  const selectedTeacher = useMemo(
    () => teachers.find((item) => String(item.id) === String(form.teacher_id)) || null,
    [form.teacher_id, teachers]
  )
  const teacherConflictMessage = selectedTeacher?.has_position || selectedTeacher?.has_homeroom
    ? 'Guru ini punya jabatan atau wali kelas. Pilih target Jabatan/Wali Kelas agar aksesnya jelas.'
    : ''

  const loadPermissions = async () => {
    setLoading(true)
    try {
      const { data: result, error } = await supabase.admin.featurePermissions()
      if (error) throw error
      setData({
        rows: Array.isArray(result?.rows) ? result.rows : [],
        groups: Array.isArray(result?.groups) ? result.groups : [],
        options: result?.options || {},
        features: Array.isArray(result?.features) ? result.features : ADMIN_FEATURES,
      })
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memuat permission admin')
    } finally {
      setLoading(false)
    }
  }

  const loadAdminList = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nama, email, status')
        .eq('role', 'admin')
        .order('nama')

      if (error) throw error

      setAdminList(
        (data || []).map((a) => ({
          id: a.id,
          nama: a.nama || a.email || 'Tanpa Nama',
          email: a.email || '-',
          status: a.status || 'active'
        }))
      )
    } catch (error) {
      pushToast('error', 'Gagal memuat data admin')
    }
  }

  useEffect(() => {
    loadPermissions()
    loadAdminList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetForm = () => {
    setForm(initialForm)
    setShowCreate(false)
  }

  const toggleFeature = (key) => {
    setForm((prev) => {
      const current = Array.isArray(prev.features) ? prev.features : []
      const next = current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
      return { ...prev, features: next }
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return

    setSaving(true)
    try {
      const { data: result, error } = await supabase.admin.createFeaturePermission(form)
      if (error) throw error
      setData({
        rows: Array.isArray(result?.rows) ? result.rows : [],
        groups: Array.isArray(result?.groups) ? result.groups : [],
        options: result?.options || data.options || {},
        features: Array.isArray(result?.features) ? result.features : ADMIN_FEATURES,
      })
      pushToast('success', 'Permission admin berhasil disimpan.')
      resetForm()
    } catch (error) {
      pushToast('error', error?.message || 'Gagal menyimpan permission admin')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleRow = async (feature) => {
    if (!feature?.id) return
    try {
      const { data: result, error } = await supabase.admin.updateFeaturePermission(feature.id, {
        is_active: !feature.active,
      })
      if (error) throw error
      setData((prev) => ({
        ...prev,
        rows: Array.isArray(result?.rows) ? result.rows : prev.rows,
        groups: Array.isArray(result?.groups) ? result.groups : prev.groups,
      }))
      pushToast('success', feature.active ? 'Permission dinonaktifkan.' : 'Permission diaktifkan.')
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memperbarui status permission')
    }
  }

  const handleDeleteRow = async (feature) => {
    if (!feature?.id) return
    const confirmed = window.confirm(`Hapus permission fitur ${feature.label}?`)
    if (!confirmed) return

    try {
      const { data: result, error } = await supabase.admin.deleteFeaturePermission(feature.id)
      if (error) throw error
      setData((prev) => ({
        ...prev,
        rows: Array.isArray(result?.rows) ? result.rows : prev.rows,
        groups: Array.isArray(result?.groups) ? result.groups : prev.groups,
      }))
      pushToast('success', 'Permission berhasil dihapus.')
    } catch (error) {
      pushToast('error', error?.message || 'Gagal menghapus permission')
    }
  }

  const availableFeatures = (data?.features?.length ? data.features : ADMIN_FEATURES)
    .filter((feature) => !feature.legacy)
  const filteredFeatures = availableFeatures
    .filter((feature) => !(form.target_type === 'homeroom' && feature.key === 'siswa'))

  return (
    <div className="page-wrapper">
      <div className="w-full space-y-6">
        <section className="page-title-card">
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-indigo-100 text-indigo-700">
                <ShieldCheck size={26} />
              </div>
              <div>
                <p className="page-title-kicker">Sistem</p>
                <h1 className="page-title-heading">Permission Admin</h1>
                <p className="page-title-description">
                  Delegasikan fitur admin sekolah tertentu ke guru, jabatan, atau wali kelas tanpa mengubah role akun utama.
                </p>
              </div>
            </div>
            <div className="page-title-actions">
              <button
                type="button"
                onClick={loadPermissions}
                className={`${actionButtonClass} border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50`}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className={`${actionButtonClass} bg-brand-600 text-white shadow-brand-sm hover:bg-brand-700`}
              >
                <Plus className="h-4 w-4" />
                Tambah Permission
              </button>
            </div>
          </div>
        </section>

      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Ringkasan Permission</h2>
            <p className="mt-1 text-xs text-slate-500">
              Kelola delegasi akses halaman admin secara aman. Setiap target tetap memakai role guru, hanya menu terpilih yang ditampilkan.
            </p>
          </div>
          <span className="inline-flex min-h-8 items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 text-xs font-bold text-indigo-700">
            {groups.length} target
          </span>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['Target', groups.length, UserPlus, 'bg-blue-50 text-blue-700', 'Guru/jabatan/wali kelas'],
            ['Fitur Aktif', activeTotal, CheckCircle2, 'bg-emerald-50 text-emerald-700', 'Menu sedang tampil'],
            ['Nonaktif', inactiveTotal, ToggleLeft, 'bg-amber-50 text-amber-700', 'Masih tersimpan'],
            ['Fitur Tersedia', availableFeatures.length, ShieldCheck, 'bg-violet-50 text-violet-700', 'Pilihan delegasi'],
          ].map(([label, value, Icon, iconClass, hint]) => (
            <div key={label} className={statCardClass}>
              <div className="flex h-full items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-2 text-3xl font-black leading-tight text-slate-950">{value}</p>
                  <p className="mt-4 text-xs text-slate-500">{hint}</p>
                </div>
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${iconClass}`}>
                  <Icon className="h-5 w-5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-100 bg-white shadow-card">
        <div className="flex flex-col gap-1 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Daftar Permission</h2>
            <p className="mt-1 text-xs text-slate-500">Setiap target bisa memiliki lebih dari satu fitur admin yang aktif.</p>
          </div>
          <span className="text-xs font-semibold text-slate-500">{groups.length} target</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[960px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-6 py-4">No</th>
                <th className="px-6 py-4">Nama/Jabatan/Wali Kelas</th>
                <th className="px-6 py-4">Fitur</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                [...Array(4)].map((_, index) => (
                  <tr key={index}>
                    <td className="px-6 py-5" colSpan={5}>
                      <div className="h-12 animate-pulse rounded-2xl bg-slate-100" />
                    </td>
                  </tr>
                ))
              ) : groups.length ? groups.map((group, index) => (
                <tr key={group.group_key || index} className="align-top">
                  <td className="px-6 py-5 font-bold text-slate-500">{index + 1}</td>
                  <td className="px-6 py-5">
                    <p className="font-black text-slate-950">{group.target_label || '-'}</p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">
                      {TARGET_TYPE_LABELS[group.target_type] || group.target_type || '-'}
                    </p>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-wrap gap-2">
                      {(group.features || []).map((feature) => (
                        <Badge key={feature.id || feature.key} active={feature.active}>{feature.label}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col gap-2">
                      <span className="font-bold text-emerald-700">{group.active_count || 0} aktif</span>
                      {!!group.inactive_count && <span className="text-xs font-bold text-slate-500">{group.inactive_count} nonaktif</span>}
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-wrap justify-end gap-2">
                      {(group.features || []).map((feature) => (
                        <div key={feature.id || feature.key} className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1">
                          <button
                            type="button"
                            onClick={() => handleToggleRow(feature)}
                            className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-black ${
                              feature.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'
                            }`}
                            title={`${feature.active ? 'Nonaktifkan' : 'Aktifkan'} ${feature.label}`}
                          >
                            {feature.active ? <Eye className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                            {feature.label}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(feature)}
                            className="rounded-xl p-1.5 text-rose-600 hover:bg-rose-50"
                            title={`Hapus ${feature.label}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td className="px-6 py-12 text-center text-slate-500" colSpan={5}>
                    <div className="mx-auto flex max-w-md flex-col items-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-8">
                      <ShieldCheck className="h-9 w-9 text-brand-500" />
                      <p className="mt-3 font-black text-slate-900">Belum ada permission admin</p>
                      <p className="mt-1 text-sm text-slate-500">Klik Tambah Permission untuk mulai mengatur akses fitur admin ke guru, jabatan, atau wali kelas.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.28em] text-brand-600">Permission Admin</p>
                <h3 className="mt-2 text-2xl font-black text-slate-950">Tambah Akses Fitur</h3>
                <p className="mt-1 text-sm text-slate-500">Pilih target, lalu centang fitur admin yang boleh tampil di panel guru.</p>
              </div>
              <button
                type="button"
                onClick={resetForm}
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Tutup permission admin"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-5 overflow-y-auto p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-500">Tipe Target</span>
                  <select
                    id="permission-target-type"
                    name="target_type"
                    className={formControlClass}
                    value={form.target_type}
                    onChange={(event) => setForm({ ...initialForm, target_type: event.target.value })}
                  >
                    <option value="teacher">Nama Guru</option>
                    <option value="position">Jabatan</option>
                    <option value="homeroom">Wali Kelas</option>
                  </select>
                </label>

                {form.target_type === 'teacher' && (
                  <label className="space-y-2">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-500">Nama Guru</span>
                    <select
                      id="permission-teacher-id"
                      name="teacher_id"
                      className={formControlClass}
                      value={form.teacher_id}
                      onChange={(event) => setForm((prev) => ({ ...prev, teacher_id: event.target.value }))}
                      required
                    >
                      <option value="">Pilih guru</option>
                      {teachers.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>{teacher.nama}</option>
                      ))}
                    </select>
                  </label>
                )}

                {form.target_type === 'position' && (
                  <label className="space-y-2">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-500">Jabatan</span>
                    <select
                      id="permission-position-id"
                      name="position_id"
                      className={formControlClass}
                      value={form.position_id}
                      onChange={(event) => setForm((prev) => ({ ...prev, position_id: event.target.value }))}
                      required
                    >
                      <option value="">Pilih jabatan</option>
                      {positions.map((position) => (
                        <option key={position.id} value={position.id}>{position.label}</option>
                      ))}
                    </select>
                  </label>
                )}

                {form.target_type === 'homeroom' && (
                  <label className="space-y-2">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-500">Wali Kelas</span>
                    <select
                      id="permission-class-id"
                      name="class_id"
                      className={formControlClass}
                      value={form.class_id}
                      onChange={(event) => setForm((prev) => ({ ...prev, class_id: event.target.value }))}
                      required
                    >
                      <option value="">Pilih kelas wali</option>
                      {homerooms.map((homeroom) => (
                        <option key={homeroom.kelas_id} value={homeroom.kelas_id}>{homeroom.label}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {teacherConflictMessage && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                  {teacherConflictMessage}
                </div>
              )}

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-slate-950">Fitur Halaman Admin</p>
                    <p className="text-xs text-slate-500">Bisa pilih lebih dari satu. Fitur Siswa tidak tersedia untuk target wali kelas.</p>
                  </div>
                  <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-black text-brand-700">{form.features.length} dipilih</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredFeatures.map((feature) => {
                    const checked = form.features.includes(feature.key)
                    return (
                      <button
                        key={feature.key}
                        type="button"
                        onClick={() => toggleFeature(feature.key)}
                        className={`flex min-h-[76px] items-center gap-3 rounded-2xl border p-4 text-left transition ${
                          checked
                            ? 'border-brand-300 bg-brand-50 text-brand-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-brand-200'
                        }`}
                      >
                        <span className={`grid h-6 w-6 place-items-center rounded-lg border ${
                          checked ? 'border-brand-500 bg-brand-600 text-white' : 'border-slate-300 bg-white'
                        }`}>
                          {checked && <CheckCircle2 className="h-4 w-4" />}
                        </span>
                        <span className="font-black">{feature.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 p-6">
              <button type="button" onClick={resetForm} className={`${actionButtonClass} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`} disabled={saving}>
                Batal
              </button>
              <button type="submit" className={`${actionButtonClass} bg-brand-600 text-white shadow-brand-sm hover:bg-brand-700`} disabled={saving}>
                {saving ? 'Menyimpan...' : 'Simpan Permission'}
              </button>
            </div>
          </form>
        </div>
      )}

      {adminList.length > 0 && (
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-3">
              <span className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                🛡️
              </span>
              Monitoring Admin
            </h2>
            <span className="px-4 py-1 text-xs font-semibold rounded-full bg-indigo-50 text-indigo-700">
              {adminList.length} admin terdaftar
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left py-3 px-3 font-semibold text-gray-700">
                    Nama
                  </th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-700">
                    Email
                  </th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-700">
                    Status Login
                  </th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-700">
                    Status Akun
                  </th>
                </tr>
              </thead>
              <tbody>
                {adminList.map((a) => {
                  const isCurrentAdmin =
                    (profile && a.id === profile.id) || (user && a.id === user.id)
                  const isActiveAccount = (a.status || 'active') === 'active'

                  return (
                    <tr
                      key={a.id}
                      className="border-b last:border-0 hover:bg-indigo-50/40 transition-colors"
                    >
                      <td className="py-3 px-3 text-gray-900 font-medium">
                        {a.nama}
                        {isCurrentAdmin && (
                          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
                            Anda
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-gray-600">{a.email}</td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${isCurrentAdmin
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-gray-100 text-gray-600'
                            }`}
                        >
                          <span className="w-2 h-2 rounded-full mr-2 bg-current" />
                          {isCurrentAdmin ? 'Online sekarang' : 'Offline'}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${isActiveAccount
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-red-100 text-red-700'
                            }`}
                        >
                          {isActiveAccount ? 'Akun aktif' : 'Akun nonaktif'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      </div>
    </div>
  )
}

export default PermissionAdmin
