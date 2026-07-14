import { apiClient } from '../lib/api/client'
import { generateRequestId } from '../lib/api/requestId'

export const assignmentService = {
  async getAssignments(params = {}) {
    try {
      const response = await apiClient.get('/api/v2/assignments', {
        params,
        headers: {
          'X-Request-ID': generateRequestId()
        }
      })
      return response.data
    } catch (error) {
      console.error('Error fetching assignments:', error)
      throw error
    }
  },

  async getAssignment(id) {
    try {
      const response = await apiClient.get(`/api/v2/assignments/${id}`, {
        headers: { 'X-Request-ID': generateRequestId() }
      })
      return response.data
    } catch (error) {
      console.error('Error fetching assignment:', error)
      throw error
    }
  },

  async storeAssignment(data) {
    try {
      const response = await apiClient.post('/api/v2/assignments', data, {
        headers: { 'X-Request-ID': generateRequestId() }
      })
      return response.data
    } catch (error) {
      console.error('Error storing assignment:', error)
      throw error
    }
  },

  async updateAssignment(id, data) {
    try {
      const response = await apiClient.patch(`/api/v2/assignments/${id}`, data, {
        headers: { 'X-Request-ID': generateRequestId() }
      })
      return response.data
    } catch (error) {
      console.error('Error updating assignment:', error)
      throw error
    }
  },

  async deleteAssignment(id) {
    try {
      const response = await apiClient.delete(`/api/v2/assignments/${id}`, {
        headers: { 'X-Request-ID': generateRequestId() }
      })
      return response.data
    } catch (error) {
      console.error('Error deleting assignment:', error)
      throw error
    }
  }
}

export const submissionService = {
  async getSubmissions(params = {}) {
    try {
      const response = await apiClient.get('/api/v2/submissions', {
        params,
        headers: { 'X-Request-ID': generateRequestId() }
      })
      return response.data
    } catch (error) {
      console.error('Error fetching submissions:', error)
      throw error
    }
  },

  async getSubmission(id) {
    try {
      const response = await apiClient.get(`/api/v2/submissions/${id}`, {
        headers: { 'X-Request-ID': generateRequestId() }
      })
      return response.data
    } catch (error) {
      console.error('Error fetching submission:', error)
      throw error
    }
  },

  async storeSubmission(data) {
    try {
      const response = await apiClient.post('/api/v2/submissions', data, {
        headers: { 'X-Request-ID': generateRequestId() }
      })
      return response.data
    } catch (error) {
      console.error('Error storing submission:', error)
      throw error
    }
  },

  async updateSubmission(id, data) {
    try {
      const response = await apiClient.patch(`/api/v2/submissions/${id}`, data, {
        headers: { 'X-Request-ID': generateRequestId() }
      })
      return response.data
    } catch (error) {
      console.error('Error updating submission:', error)
      throw error
    }
  },

  async gradeSubmission(id, data) {
    try {
      const response = await apiClient.patch(`/api/v2/submissions/${id}/grade`, data, {
        headers: { 'X-Request-ID': generateRequestId() }
      })
      return response.data
    } catch (error) {
      console.error('Error grading submission:', error)
      throw error
    }
  },

  async gradeByUser(data) {
    try {
      const response = await apiClient.post(`/api/v2/submissions/grade-by-user`, data, {
        headers: { 'X-Request-ID': generateRequestId() }
      })
      return response.data
    } catch (error) {
      console.error('Error grading submission by user:', error)
      throw error
    }
  },

  async deleteSubmission(id) {
    try {
      const response = await apiClient.delete(`/api/v2/submissions/${id}`, {
        headers: { 'X-Request-ID': generateRequestId() }
      })
      return response.data
    } catch (error) {
      console.error('Error deleting submission:', error)
      throw error
    }
  }
}
