// src/AppRoutes.jsx
import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import RoleGate from './components/RoleGate'
import AdminLockGate from './components/AdminLockGate'

import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'

// Siswa
import SHome from './pages/siswa/Home'
import SAbsensi from './pages/siswa/Absensi'
import STugas from './pages/siswa/Tugas'
import SEditProfile from './pages/siswa/EditProfile'
import SQuiz from './pages/siswa/Quiz'

// Guru
import GJadwal from './pages/guru/JadwalGuru'
import GAbsensi from './pages/guru/AbsensiGuru'
import GTugas from './pages/guru/TugasGuru'
import GLaporan from './pages/guru/Laporan'
import GProfile from './pages/guru/profile'
import GQuiz from './pages/guru/Quiz'

// Admin
import AHome from './pages/admin/Home'
import AKelas from './pages/admin/Kelas'
import AGuru from './pages/admin/Guru'
import ASiswa from './pages/admin/Siswa'
import AScan from './pages/admin/Scan'
import Sertifikat from './pages/admin/Sertifikat'
import APengaturan from './pages/admin/pengaturan'
import ATenants from './pages/admin/Tenants'
import ASuperAdmins from './pages/admin/SuperAdmins'

const AppRoutes = () => {
  return (
    <Routes>
      {/* Auth (tidak butuh login) */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* SISWA */}
      <Route
        element={
          <ProtectedRoute>
            <RoleGate allow={['siswa']} />
          </ProtectedRoute>
        }
      >
        <Route path="/siswa/home" element={<SHome />} />
        <Route path="/siswa/absensi" element={<SAbsensi />} />
        <Route path="/siswa/quiz" element={<SQuiz />} />
        <Route path="/siswa/quiz/session/:quizId" element={<SQuiz />} />
        <Route path="/siswa/tugas" element={<STugas />} />
        <Route path="/siswa/profile" element={<SEditProfile />} />
      </Route>

      {/* GURU */}
      <Route
        element={
          <ProtectedRoute>
            <RoleGate allow={['guru']} />
          </ProtectedRoute>
        }
      >
        <Route path="/guru/jadwal" element={<GJadwal />} />
        <Route path="/guru/absensi" element={<GAbsensi />} />
        <Route path="/guru/quiz" element={<GQuiz />} />
        <Route path="/guru/tugas" element={<GTugas />} />
        <Route path="/guru/laporan" element={<GLaporan />} />
        <Route path="/guru/siswa" element={<ASiswa />} />
        <Route path="/guru/profile" element={<GProfile />} />
      </Route>

      {/* ADMIN */}
      <Route
        element={
          <ProtectedRoute>
            <RoleGate allow={['admin']} />
          </ProtectedRoute>
        }
      >
        <Route path="/admin/pengaturan" element={<APengaturan />} />
        <Route path="/admin/tenants" element={<ATenants />} />
        <Route path="/admin/super-admins" element={<ASuperAdmins />} />
        <Route element={<AdminLockGate />}>
          <Route path="/admin/home" element={<AHome />} />
          <Route path="/admin/kelas" element={<AKelas />} />
          <Route path="/admin/guru" element={<AGuru />} />
          <Route path="/admin/siswa" element={<ASiswa />} />
          <Route path="/admin/scan" element={<AScan />} />
          <Route path="/admin/sertifikat" element={<Sertifikat />} />
        </Route>
      </Route>

      {/* Default - Redirect ke login */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

export default AppRoutes
