import { apiClient } from '../lib/api/client';

export const extracurricularService = {
  async getExtracurriculars() {
    return apiClient('/api/v2/extracurriculars');
  },

  async getExtracurricularById(id) {
    return apiClient(`/api/v2/extracurriculars/${id}`);
  },

  async createExtracurricular(payload) {
    return apiClient('/api/v2/extracurriculars', { method: 'POST', body: payload });
  },

  async updateExtracurricular(id, payload) {
    return apiClient(`/api/v2/extracurriculars/${id}`, { method: 'PUT', body: payload });
  },

  async deleteExtracurricular(id) {
    return apiClient(`/api/v2/extracurriculars/${id}`, { method: 'DELETE' });
  },

  async getMembers(id) {
    return apiClient(`/api/v2/extracurriculars/${id}/members`);
  },

  async joinExtracurricular(id, studentId = null) {
    const payload = studentId ? { student_id: studentId } : {};
    return apiClient(`/api/v2/extracurriculars/${id}/join`, { method: 'POST', body: payload });
  },

  async leaveExtracurricular(id, studentId = null) {
    const params = studentId ? { student_id: studentId } : {};
    return apiClient(`/api/v2/extracurriculars/${id}/leave`, { method: 'DELETE', params });
  }
};
