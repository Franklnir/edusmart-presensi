import { apiClient } from '../lib/api/client';

export const certificateService = {
  // --- Sertifikat (Issued) ---
  getAllCertificates: async (params = {}) => {
    return apiClient('/api/v2/certificates', { params })
  },

  createCertificate: async (payload) => {
    return apiClient('/api/v2/certificates', { method: 'POST', body: payload })
  },

  updateCertificate: async (id, payload) => {
    return apiClient(`/api/v2/certificates/${id}`, { method: 'PUT', body: payload })
  },

  deleteCertificate: async (id) => {
    return apiClient(`/api/v2/certificates/${id}`, { method: 'DELETE' })
  },

  getCertificateById: async (id) => {
    return apiClient(`/api/v2/certificates/${id}`)
  },

  // --- Template Sertifikat ---
  getAllTemplates: async (params = {}) => {
    return apiClient('/api/v2/certificate-templates', { params })
  },

  createTemplate: async (payload) => {
    return apiClient('/api/v2/certificate-templates', { method: 'POST', body: payload })
  },

  updateTemplate: async (id, payload) => {
    return apiClient(`/api/v2/certificate-templates/${id}`, { method: 'PUT', body: payload })
  },

  deleteTemplate: async (id) => {
    return apiClient(`/api/v2/certificate-templates/${id}`, { method: 'DELETE' })
  },

  getTemplateById: async (id) => {
    return apiClient(`/api/v2/certificate-templates/${id}`)
  }
}
