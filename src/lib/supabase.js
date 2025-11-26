import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase env not set')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true
  }
})

export const ASSIGNMENT_BUCKET = import.meta.env.VITE_SUPABASE_BUCKET
export const PROFILE_BUCKET = import.meta.env.VITE_SUPABASE_PROFILE_BUCKET
