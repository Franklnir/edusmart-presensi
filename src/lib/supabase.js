// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase env not set')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // penting utk reset password / magic link
  },
})

export const ASSIGNMENT_BUCKET = import.meta.env.VITE_SUPABASE_BUCKET
export const PROFILE_BUCKET   = import.meta.env.VITE_SUPABASE_PROFILE_BUCKET

// ➕ TAMBAHAN: bucket untuk sertifikat
export const CERT_BUCKET =
  import.meta.env.VITE_SUPABASE_CERT_BUCKET || 'certificates'

  // Bucket gambar template (PNG dari Canva)
export const CERT_TEMPLATE_BUCKET = 'certificate-templates'
