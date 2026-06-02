import React, { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
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

const statCardClass = 'page-card min-h-[132px] p-5'
const formControlClass = 'h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-900 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100'
const actionButtonClass = 'inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60'

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

  useEffect(() => {
    loadPermissions()
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

  const filteredFeatures = (data?.features?.length ? data.features : ADMIN_FEATURES)
    .filter((feature) => !(form.target_type === 'homeroom' && feature.key === 'siswa'))

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="page-card p-6 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="page-title-accent" />
            <div>
              <p className="page-title-kicker">Sistem</p>
              <h1 className="page-title">Permission Admin</h1>
              <p className="page-title-description max-w-3xl">
                Delegasikan fitur admin sekolah tertentu ke guru, jabatan, atau wali kelas tanpa mengubah role akun utama.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
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

      <section className="grid gap-4 md:grid-cols-4">
        {[
          ['Target', groups.length, UserPlus, 'bg-blue-50 text-blue-700'],
          ['Fitur aktif', activeTotal, CheckCircle2, 'bg-emerald-50 text-emerald-700'],
          ['Nonaktif', inactiveTotal, ToggleLeft, 'bg-amber-50 text-amber-700'],
          ['Fitur tersedia', ADMIN_FEATURES.length, ShieldCheck, 'bg-violet-50 text-violet-700'],
        ].map(([label, value, Icon, iconClass]) => (
          <div key={label} className={statCardClass}>
            <div className="flex h-full items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
              </div>
              <div className={`rounded-2xl p-3 ${iconClass}`}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="page-card overflow-hidden shadow-card">
        <div className="border-b border-slate-100 px-6 py-5">
          <h2 className="text-lg font-black text-slate-950">Daftar Permission</h2>
          <p className="mt-1 text-sm text-slate-500">Setiap target bisa memiliki lebih dari satu fitur admin yang aktif.</p>
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
                            {feature.active ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
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
    </div>
  )
}

export default PermissionAdmin
