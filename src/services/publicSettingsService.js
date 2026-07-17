import { supabase } from '../lib/supabase'
import { logFrontendError } from '../lib/api/client'

export const publicSettingsService = {
  async getSettings() {
    const { data, error } = await supabase.public.settings()
    if (error) {
      logFrontendError('warn', `Public settings error: ${error.message || 'unknown'}`, {
        code: error.code
      })
    }
    return { data, error }
  }
}
