import { apiClient } from '../client'

export const ClassesApi = {
  /**
   * Fetch all classes.
   */
  getAll: async (params = {}, options = {}) => {
    const searchParams = new URLSearchParams(params)
    const qs = searchParams.toString()
    const endpoint = qs ? `/api/v2/classes?${qs}` : '/api/v2/classes'
    
    return apiClient(endpoint, {
      method: 'GET',
      ...options
    })
  },

  /**
   * Create a new class.
   */
  create: async (data) => {
    return apiClient('/api/v2/classes', {
      method: 'POST',
      body: data
    })
  },

  /**
   * Update an existing class.
   */
  update: async (id, data) => {
    return apiClient(`/api/v2/classes/${id}`, {
      method: 'PATCH',
      body: data
    })
  },

  /**
   * Delete a class.
   */
  delete: async (id) => {
    return apiClient(`/api/v2/classes/${id}`, {
      method: 'DELETE'
    })
  }
}
