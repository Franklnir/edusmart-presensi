import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/time'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'

const manifestExample = `{
  "schema_version": 1,
  "name": "Plugin Akademik Pro",
  "slug": "plugin-akademik-pro",
  "version": "1.0.0",
  "description": "Menambahkan paket fitur akademik tambahan.",
  "details": "Jelaskan fitur plugin, dependensi, dan catatan rilis di sini.",
  "github_url": "https://github.com/organisasi/repo-plugin",
  "homepage_url": "https://contoh-plugin.id",
  "author": {
    "name": "Tim EduSmart",
    "email": "plugin@edusmart.id"
  },
  "compatibility": {
    "min_app_version": "1.0.0",
    "max_app_version": "2.0.0"
  },
  "capabilities": [
    "laporan-tambahan",
    "otomasi-akademik"
  ]
}`

const DetailList = ({ title, items = [] }) => {
  if (!Array.isArray(items) || items.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={`${title}-${item}`}
            className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

const MetadataBlock = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-1 text-sm font-medium text-slate-800 break-words">{value || '-'}</div>
  </div>
)

const Plugins = () => {
  const { isSuperAdmin, superAdminChecked } = useAuthStore()
  const { pushToast } = useUIStore()

  const [plugins, setPlugins] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const [selectedFile, setSelectedFile] = useState(null)
  const [inspectLoading, setInspectLoading] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [draft, setDraft] = useState(null)

  const [statusId, setStatusId] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const [downloadingId, setDownloadingId] = useState('')

  const filteredPlugins = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return plugins

    return plugins.filter((plugin) => {
      const haystack = [
        plugin.name,
        plugin.slug,
        plugin.version,
        plugin.description,
        plugin.uploaded_by?.name,
        plugin.uploaded_by?.email,
        plugin.github_url,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(keyword)
    })
  }, [plugins, search])

  const activeCount = useMemo(
    () => plugins.filter((plugin) => plugin.is_active).length,
    [plugins]
  )

  const loadPlugins = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.super.plugins()
      if (error) throw error
      setPlugins(Array.isArray(data) ? data : [])
    } catch (err) {
      pushToast('error', err?.message || 'Gagal memuat daftar plugin')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!superAdminChecked || !isSuperAdmin) return
    loadPlugins()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [superAdminChecked, isSuperAdmin])

  const resetDraft = () => {
    setDraft(null)
    setSelectedFile(null)
  }

  const handleInspect = async (e) => {
    e.preventDefault()
    if (inspectLoading) return
    if (!selectedFile) {
      pushToast('error', 'Pilih file ZIP plugin terlebih dahulu')
      return
    }

    const formData = new FormData()
    formData.append('plugin_zip', selectedFile)

    setInspectLoading(true)
    try {
      const { data, error } = await supabase.super.inspectPlugin(formData)
      if (error) throw error
      setDraft(data || null)
      pushToast('success', 'ZIP plugin berhasil diverifikasi')
    } catch (err) {
      pushToast('error', err?.message || 'ZIP plugin gagal diverifikasi')
    } finally {
      setInspectLoading(false)
    }
  }

  const handleInstall = async () => {
    if (!draft?.id || installing) return

    let replaceExisting = false
    if (draft?.existing_plugin?.id) {
      const confirmed = window.confirm(
        `Plugin ${draft.slug} sudah ada versi ${draft.existing_plugin.version}. Ganti paket lama dengan versi baru ini?`
      )
      if (!confirmed) return
      replaceExisting = true
    }

    setInstalling(true)
    try {
      const { data, error } = await supabase.super.installPlugin({
        draft_id: draft.id,
        replace_existing: replaceExisting
      })
      if (error) throw error

      pushToast(
        'success',
        replaceExisting
          ? `Plugin ${data?.name || draft.name} berhasil diganti dan statusnya direset ke nonaktif`
          : `Plugin ${data?.name || draft.name} berhasil dipasang`
      )
      resetDraft()
      await loadPlugins()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal memasang plugin')
    } finally {
      setInstalling(false)
    }
  }

  const handleToggleStatus = async (plugin) => {
    if (!plugin?.id || statusId) return
    setStatusId(plugin.id)
    try {
      const { error } = await supabase.super.updatePluginStatus(plugin.id, {
        is_active: !plugin.is_active
      })
      if (error) throw error

      pushToast(
        'success',
        !plugin.is_active
          ? `Plugin ${plugin.name} diaktifkan`
          : `Plugin ${plugin.name} dinonaktifkan`
      )
      await loadPlugins()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal mengubah status plugin')
    } finally {
      setStatusId('')
    }
  }

  const handleDelete = async (plugin) => {
    if (!plugin?.id || deletingId) return
    const confirmed = window.confirm(
      `Hapus plugin ${plugin.name} v${plugin.version}? Arsip ZIP dan hasil ekstraknya juga akan ikut dihapus.`
    )
    if (!confirmed) return

    setDeletingId(plugin.id)
    try {
      const { error } = await supabase.super.deletePlugin(plugin.id, { confirm: true })
      if (error) throw error
      pushToast('success', `Plugin ${plugin.name} dihapus`)
      await loadPlugins()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menghapus plugin')
    } finally {
      setDeletingId('')
    }
  }

  const handleDownload = async (plugin) => {
    if (!plugin?.id || downloadingId) return
    setDownloadingId(plugin.id)
    try {
      const { error } = await supabase.super.downloadPlugin(
        plugin.id,
        plugin.download_name || `${plugin.slug}-${plugin.version}.zip`
      )
      if (error) throw error
      pushToast('success', `Plugin ${plugin.name} berhasil diunduh`)
    } catch (err) {
      pushToast('error', err?.message || 'Gagal mengunduh plugin')
    } finally {
      setDownloadingId('')
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
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Akses ditolak</h2>
          <p className="mt-2 text-sm text-slate-600">
            Halaman plugin hanya tersedia untuk super admin.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="page-title-card">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-sm font-bold text-blue-700">
            PL
          </div>
          <div>
            <h1 className="page-title-heading">Plugin Manager</h1>
            <p className="page-title-description">
              Upload ZIP plugin, verifikasi manifest lebih dulu, lalu aktifkan atau nonaktifkan plugin dengan aman dari area super admin.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <div className="text-sm font-semibold uppercase tracking-wide text-amber-700">
              Alur Aman Upload Plugin
            </div>
            <div className="text-sm leading-6 text-amber-900">
              ZIP plugin tidak langsung dipasang. Sistem akan memeriksa isi arsip, memastikan ada
              <span className="mx-1 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">plugin.json</span>
              di root, memblokir file berbahaya, lalu membuat draft verifikasi terlebih dahulu.
            </div>
            <div className="grid gap-2 text-sm text-amber-900 md:grid-cols-2">
              <div>1. Pilih ZIP plugin dan klik verifikasi.</div>
              <div>2. Cek slug, versi, checksum, dan metadata plugin.</div>
              <div>3. Jika cocok, klik pasang plugin.</div>
              <div>4. Setelah terpasang, aktifkan manual agar aman.</div>
            </div>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-white/80 p-4 text-xs text-amber-900">
            <div className="font-semibold">Catatan keamanan</div>
            <div className="mt-2 leading-5">
              Paket plugin disimpan dan diverifikasi dengan ketat. Kode server yang berbahaya seperti
              file <span className="font-mono">.php</span>, <span className="font-mono">.sh</span>,
              atau executable lain akan langsung ditolak saat verifikasi ZIP.
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Upload & Verifikasi ZIP</h2>
              <p className="mt-1 text-sm text-slate-600">
                ZIP wajib berisi <span className="font-mono text-xs">plugin.json</span> di folder root.
              </p>
            </div>
            <button
              type="button"
              onClick={resetDraft}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Reset Draft
            </button>
          </div>

          <form onSubmit={handleInspect} className="mt-5 space-y-4">
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
              <label className="text-sm font-semibold text-slate-700">Pilih file ZIP plugin</label>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => {
                  setSelectedFile(e.target.files?.[0] || null)
                  setDraft(null)
                }}
                className="mt-3 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700"
              />
              <div className="mt-3 text-xs text-slate-500">
                {selectedFile
                  ? `File dipilih: ${selectedFile.name} (${Math.round(selectedFile.size / 1024)} KB)`
                  : 'Belum ada file dipilih'}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={!selectedFile || inspectLoading}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {inspectLoading ? 'Memverifikasi ZIP...' : 'Verifikasi ZIP Plugin'}
              </button>
              {draft?.id && (
                <button
                  type="button"
                  onClick={handleInstall}
                  disabled={installing}
                  className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {installing ? 'Memasang Plugin...' : 'Pasang Plugin'}
                </button>
              )}
            </div>
          </form>

          {draft && (
            <div className="mt-6 space-y-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Draft Terverifikasi
                  </div>
                  <h3 className="mt-1 text-xl font-bold text-slate-900">
                    {draft.name} <span className="text-sm font-medium text-slate-500">v{draft.version}</span>
                  </h3>
                  <p className="mt-1 text-sm text-slate-700">
                    Slug: <span className="font-mono">{draft.slug}</span>
                  </p>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-xs text-slate-600">
                  <div>Checksum SHA-256</div>
                  <div className="mt-1 break-all font-mono text-[11px] text-slate-800">
                    {draft.checksum_sha256}
                  </div>
                </div>
              </div>

              {draft.existing_plugin && (
                <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
                  Plugin dengan slug yang sama sudah ada:
                  <span className="ml-1 font-semibold">
                    {draft.existing_plugin.name} v{draft.existing_plugin.version}
                  </span>.
                  Kalau kamu lanjut pasang, paket lama akan diganti dan status plugin akan direset ke nonaktif.
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetadataBlock label="File ZIP" value={draft.original_filename} />
                <MetadataBlock label="Ukuran ZIP" value={draft.archive_size_label} />
                <MetadataBlock label="Ukuran Ekstrak" value={draft.extracted_size_label} />
                <MetadataBlock label="Jumlah File" value={`${draft.file_count} file`} />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">Ringkasan Manifest</div>
                  <div className="text-sm text-slate-700">{draft.manifest?.description || '-'}</div>
                  <MetadataBlock label="GitHub URL" value={draft.manifest?.github_url || '-'} />
                  <MetadataBlock
                    label="Author"
                    value={
                      draft.manifest?.author?.name ||
                      draft.manifest?.author?.email ||
                      '-'
                    }
                  />
                </div>

                <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">Catatan Verifikasi</div>
                  <DetailList
                    title="Capabilities"
                    items={draft.metadata?.capabilities || draft.manifest?.capabilities || []}
                  />
                  {(draft.metadata?.warnings || []).length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Warning
                      </div>
                      <div className="space-y-2">
                        {(draft.metadata?.warnings || []).map((warning) => (
                          <div
                            key={warning}
                            className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900"
                          >
                            {warning}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                      Tidak ada warning penting dari verifikasi awal.
                    </div>
                  )}
                </div>
              </div>

              {(draft.metadata?.readme_excerpt || draft.manifest?.details) && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">Detail Plugin</div>
                  {draft.manifest?.details && (
                    <div className="mt-2 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                      {draft.manifest.details}
                    </div>
                  )}
                  {draft.metadata?.readme_excerpt && (
                    <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100">
                      {draft.metadata.readme_excerpt}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-900">Template plugin.json</h2>
            <p className="text-sm text-slate-600">
              Letakkan file ini di root ZIP supaya plugin bisa diverifikasi sebelum dipasang.
            </p>
          </div>
          <pre className="mt-4 max-h-[540px] overflow-auto rounded-2xl bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100">
            {manifestExample}
          </pre>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Daftar Plugin Terpasang</h2>
            <p className="mt-1 text-sm text-slate-600">
              Total {plugins.length} plugin, {activeCount} aktif, {plugins.length - activeCount} nonaktif.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari plugin, slug, versi, uploader..."
              className="min-w-[280px] rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <button
              type="button"
              onClick={loadPlugins}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Muat Ulang
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Memuat daftar plugin...
            </div>
          ) : filteredPlugins.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Belum ada plugin yang terpasang.
            </div>
          ) : (
            filteredPlugins.map((plugin) => (
              <div
                key={plugin.id}
                className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-xl font-bold text-slate-900">
                        {plugin.name}
                        <span className="ml-2 text-sm font-medium text-slate-500">
                          v{plugin.version}
                        </span>
                      </h3>
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                          plugin.is_active
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {plugin.status_label}
                      </span>
                    </div>
                    <div className="text-sm text-slate-600">
                      Slug: <span className="font-mono text-slate-900">{plugin.slug}</span>
                    </div>
                    <div className="text-sm text-slate-700">
                      {plugin.description || 'Belum ada deskripsi plugin.'}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(plugin)}
                      disabled={statusId === plugin.id}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                        plugin.is_active ? 'bg-slate-700 hover:bg-slate-800' : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}
                    >
                      {statusId === plugin.id
                        ? 'Menyimpan...'
                        : plugin.is_active
                          ? 'Nonaktifkan'
                          : 'Aktifkan'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownload(plugin)}
                      disabled={downloadingId === plugin.id}
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {downloadingId === plugin.id ? 'Mengunduh...' : 'Download ZIP'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(plugin)}
                      disabled={deletingId === plugin.id}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingId === plugin.id ? 'Menghapus...' : 'Hapus Plugin'}
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <MetadataBlock
                    label="Ter-upload"
                    value={plugin.uploaded_at ? formatDateTime(plugin.uploaded_at) : '-'}
                  />
                  <MetadataBlock
                    label="By"
                    value={plugin.uploaded_by?.name || plugin.uploaded_by?.email || '-'}
                  />
                  <MetadataBlock label="GitHub URL" value={plugin.github_url || '-'} />
                  <MetadataBlock
                    label="Ukuran / File"
                    value={`${plugin.archive_size_label} / ${plugin.file_count} file`}
                  />
                </div>

                {(plugin.details || plugin.metadata?.readme_excerpt) && (
                  <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-sm font-semibold text-slate-900">Detail Plugin</div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                        {plugin.details || 'Belum ada detail tambahan di manifest.'}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-sm font-semibold text-slate-900">README Ringkas</div>
                      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100">
                        {plugin.metadata?.readme_excerpt || 'README tidak tersedia.'}
                      </pre>
                    </div>
                  </div>
                )}

                <div className="mt-4 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-semibold text-slate-900">Manifest & Kompatibilitas</div>
                    <div className="mt-3 space-y-2 text-sm text-slate-700">
                      <div>
                        Min app version:{' '}
                        <span className="font-semibold">
                          {plugin.manifest?.compatibility?.min_app_version || '-'}
                        </span>
                      </div>
                      <div>
                        Max app version:{' '}
                        <span className="font-semibold">
                          {plugin.manifest?.compatibility?.max_app_version || '-'}
                        </span>
                      </div>
                      <div>
                        SHA-256:{' '}
                        <span className="break-all font-mono text-xs text-slate-900">
                          {plugin.checksum_sha256}
                        </span>
                      </div>
                    </div>
                    <DetailList title="Capabilities" items={plugin.manifest?.capabilities || []} />
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-semibold text-slate-900">Catatan Paket</div>
                    {(plugin.metadata?.warnings || []).length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {(plugin.metadata?.warnings || []).map((warning) => (
                          <div
                            key={`${plugin.id}-${warning}`}
                            className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900"
                          >
                            {warning}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                        Manifest plugin terlihat rapi dan tidak ada warning utama dari proses verifikasi.
                      </div>
                    )}
                    <div className="mt-4 text-xs text-slate-500">
                      File asli: <span className="font-mono text-slate-700">{plugin.package_filename}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default Plugins
