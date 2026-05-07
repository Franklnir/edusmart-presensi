export const VALID_ROLES = ['admin', 'guru', 'siswa']

export const ROLE_HOME = {
  admin: '/admin/home',
  guru: '/guru/jadwal',
  siswa: '/siswa/home'
}

export const isValidRole = (role) => VALID_ROLES.includes(role)

export const getRoleHome = (role) => ROLE_HOME[role] || '/login'
