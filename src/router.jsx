import React, { Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AdminLockGate from './components/AdminLockGate'
import ProtectedRoute from './components/ProtectedRoute'
import RoleGate from './components/RoleGate'
import { lazyRoute } from './lib/routePrefetch'

const Login = lazyRoute('/login')
const GoogleAuthPopup = lazyRoute('/auth/google/popup')
const Register = lazyRoute('/register')
const ForgotPassword = lazyRoute('/forgot-password')
const ResetPassword = lazyRoute('/reset-password')

const SHome = lazyRoute('/siswa/home')
const SAbsensi = lazyRoute('/siswa/absensi')
const STugas = lazyRoute('/siswa/tugas')
const SEditProfile = lazyRoute('/siswa/profile')
const SQuiz = lazyRoute('/siswa/quiz')

const GJadwal = lazyRoute('/guru/jadwal')
const GAbsensi = lazyRoute('/guru/absensi')
const GTugas = lazyRoute('/guru/tugas')
const GLaporan = lazyRoute('/guru/laporan')
const GProfile = lazyRoute('/guru/profile')
const GQuiz = lazyRoute('/guru/quiz')

const AHome = lazyRoute('/admin/home')
const AKelas = lazyRoute('/admin/kelas')
const AJadwal = lazyRoute('/admin/jadwal')
const AStrukturSekolah = lazyRoute('/admin/struktur-sekolah')
const AOrganisasi = lazyRoute('/admin/organisasi')
const AGuru = lazyRoute('/admin/guru')
const ASiswa = lazyRoute('/admin/siswa')
const AScan = lazyRoute('/admin/scan')
const Sertifikat = lazyRoute('/admin/sertifikat')
const ABackup = lazyRoute('/admin/backup')
const AStorage = lazyRoute('/admin/storage')
const APengaturan = lazyRoute('/admin/pengaturan')
const ATenants = lazyRoute('/admin/tenants')
const ASuperAdmins = lazyRoute('/admin/super-admins')
const AApprovals = lazyRoute('/admin/approvals')
const AAuditTrail = lazyRoute('/admin/audit-trail')
const APlugins = lazyRoute('/admin/plugins')
const AWhatsApp = lazyRoute('/admin/whatsapp')

const RouteFallback = () => (
  <div className="w-full min-h-[40vh] grid place-items-center">
    <div className="text-sm text-slate-500">Memuat halaman...</div>
  </div>
)

const lazyElement = (Component) => (
  <Suspense fallback={<RouteFallback />}>
    <Component />
  </Suspense>
)

const AppRoutes = () => (
  <Routes>
    {/* Auth (tidak butuh login) */}
    <Route path="/login" element={lazyElement(Login)} />
    <Route path="/auth/google/popup" element={lazyElement(GoogleAuthPopup)} />
    <Route path="/register" element={lazyElement(Register)} />
    <Route path="/forgot-password" element={lazyElement(ForgotPassword)} />
    <Route path="/reset-password" element={lazyElement(ResetPassword)} />

    {/* SISWA */}
    <Route
      element={
        <ProtectedRoute>
          <RoleGate allow={['siswa']} />
        </ProtectedRoute>
      }
    >
      <Route path="/siswa/home" element={lazyElement(SHome)} />
      <Route path="/siswa/absensi" element={lazyElement(SAbsensi)} />
      <Route path="/siswa/quiz" element={lazyElement(SQuiz)} />
      <Route path="/siswa/quiz/session/:quizId" element={lazyElement(SQuiz)} />
      <Route path="/siswa/tugas" element={lazyElement(STugas)} />
      <Route path="/siswa/profile" element={lazyElement(SEditProfile)} />
    </Route>

    {/* GURU */}
    <Route
      element={
        <ProtectedRoute>
          <RoleGate allow={['guru']} />
        </ProtectedRoute>
      }
    >
      <Route path="/guru/jadwal" element={lazyElement(GJadwal)} />
      <Route path="/guru/absensi" element={lazyElement(GAbsensi)} />
      <Route path="/guru/quiz" element={lazyElement(GQuiz)} />
      <Route path="/guru/tugas" element={lazyElement(GTugas)} />
      <Route path="/guru/laporan" element={lazyElement(GLaporan)} />
      <Route path="/guru/siswa" element={lazyElement(ASiswa)} />
      <Route path="/guru/profile" element={lazyElement(GProfile)} />
    </Route>

    {/* ADMIN */}
    <Route
      element={
        <ProtectedRoute>
          <RoleGate allow={['admin']} />
        </ProtectedRoute>
      }
    >
      <Route path="/admin/pengaturan" element={lazyElement(APengaturan)} />
      <Route path="/admin/tenants" element={lazyElement(ATenants)} />
      <Route path="/admin/super-admins" element={lazyElement(ASuperAdmins)} />
      <Route path="/admin/audit-trail" element={lazyElement(AAuditTrail)} />
      <Route path="/admin/plugins" element={lazyElement(APlugins)} />
      <Route path="/admin/storage" element={lazyElement(AStorage)} />
      <Route element={<AdminLockGate />}>
        <Route path="/admin/home" element={lazyElement(AHome)} />
        <Route path="/admin/kelas" element={lazyElement(AKelas)} />
        <Route path="/admin/jadwal" element={lazyElement(AJadwal)} />
        <Route path="/admin/struktur-sekolah" element={lazyElement(AStrukturSekolah)} />
        <Route path="/admin/organisasi" element={lazyElement(AOrganisasi)} />
        <Route path="/admin/guru" element={lazyElement(AGuru)} />
        <Route path="/admin/siswa" element={lazyElement(ASiswa)} />
        <Route path="/admin/scan" element={lazyElement(AScan)} />
        <Route path="/admin/backup" element={lazyElement(ABackup)} />
        <Route path="/admin/approvals" element={lazyElement(AApprovals)} />
        <Route path="/admin/sertifikat" element={lazyElement(Sertifikat)} />
        <Route path="/admin/whatsapp" element={lazyElement(AWhatsApp)} />
      </Route>
    </Route>

    {/* Default - Redirect ke login */}
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes>
)

export default AppRoutes
