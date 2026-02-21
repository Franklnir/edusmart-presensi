import React, { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AdminLockGate from './components/AdminLockGate'
import ProtectedRoute from './components/ProtectedRoute'
import RoleGate from './components/RoleGate'

const Login = lazy(() => import('./pages/auth/Login'))
const Register = lazy(() => import('./pages/auth/Register'))
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'))

const SHome = lazy(() => import('./pages/siswa/Home'))
const SAbsensi = lazy(() => import('./pages/siswa/Absensi'))
const STugas = lazy(() => import('./pages/siswa/Tugas'))
const SEditProfile = lazy(() => import('./pages/siswa/EditProfile'))
const SQuiz = lazy(() => import('./pages/siswa/Quiz'))

const GJadwal = lazy(() => import('./pages/guru/JadwalGuru'))
const GAbsensi = lazy(() => import('./pages/guru/AbsensiGuru'))
const GTugas = lazy(() => import('./pages/guru/TugasGuru'))
const GLaporan = lazy(() => import('./pages/guru/Laporan'))
const GProfile = lazy(() => import('./pages/guru/profile'))
const GQuiz = lazy(() => import('./pages/guru/Quiz'))

const AHome = lazy(() => import('./pages/admin/Home'))
const AKelas = lazy(() => import('./pages/admin/Kelas'))
const AGuru = lazy(() => import('./pages/admin/Guru'))
const ASiswa = lazy(() => import('./pages/admin/Siswa'))
const AScan = lazy(() => import('./pages/admin/Scan'))
const Sertifikat = lazy(() => import('./pages/admin/Sertifikat'))
const ABackup = lazy(() => import('./pages/admin/Backup'))
const APengaturan = lazy(() => import('./pages/admin/pengaturan'))
const ATenants = lazy(() => import('./pages/admin/Tenants'))
const ASuperAdmins = lazy(() => import('./pages/admin/SuperAdmins'))
const AApprovals = lazy(() => import('./pages/admin/Approvals'))
const AAuditTrail = lazy(() => import('./pages/admin/AuditTrail'))

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
      <Route element={<AdminLockGate />}>
        <Route path="/admin/home" element={lazyElement(AHome)} />
        <Route path="/admin/kelas" element={lazyElement(AKelas)} />
        <Route path="/admin/guru" element={lazyElement(AGuru)} />
        <Route path="/admin/siswa" element={lazyElement(ASiswa)} />
        <Route path="/admin/scan" element={lazyElement(AScan)} />
        <Route path="/admin/backup" element={lazyElement(ABackup)} />
        <Route path="/admin/approvals" element={lazyElement(AApprovals)} />
        <Route path="/admin/sertifikat" element={lazyElement(Sertifikat)} />
      </Route>
    </Route>

    {/* Default - Redirect ke login */}
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes>
)

export default AppRoutes
