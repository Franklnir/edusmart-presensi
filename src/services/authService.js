import { supabase } from '../lib/supabase'

export const verifyCurrentUserPassword = async (password) => {
  const trimmedPassword = String(password || '').trim()
  if (!trimmedPassword) {
    throw new Error('Password tidak boleh kosong')
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user?.email) {
    throw new Error('User tidak ditemukan / email tidak tersedia')
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: trimmedPassword
  })

  if (error) {
    throw new Error('Password salah')
  }

  return true
}
