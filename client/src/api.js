const API = (import.meta.env.VITE_API_URL || 'http://localhost:4200').replace(/\/+$/, '');

async function request(path, { method = 'GET', body, isForm } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    credentials: 'include', // session cookie
    ...(body && !isForm ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    ...(isForm ? { body } : {}),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j?.error) message = j.error; } catch { /* non-JSON */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  // auth
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  session: () => request('/auth/session'),

  // institutions + contacts
  institutions: (q = '') => request(`/api/institutions${q}`),
  createInstitution: (body) => request('/api/institutions', { method: 'POST', body }),
  updateInstitution: (id, body) => request(`/api/institutions/${id}`, { method: 'PATCH', body }),
  contacts: (q = '') => request(`/api/contacts${q}`),
  createContact: (body) => request('/api/contacts', { method: 'POST', body }),
  deleteContact: (id) => request(`/api/contacts/${id}`, { method: 'DELETE' }),
  importCsv: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('/api/import', { method: 'POST', body: fd, isForm: true });
  },
  suppressions: () => request('/api/suppressions'),
  addSuppression: (body) => request('/api/suppressions', { method: 'POST', body }),

  // campaigns
  campaigns: () => request('/api/campaigns'),
  allEnrollments: (q = '') => request(`/api/campaigns/all-enrollments${q}`),
  allMessages: (q = '') => request(`/api/campaigns/all-messages${q}`),
  campaign: (id) => request(`/api/campaigns/${id}`),
  createCampaign: (body) => request('/api/campaigns', { method: 'POST', body }),
  updateCampaign: (id, body) => request(`/api/campaigns/${id}`, { method: 'PATCH', body }),
  setStatus: (id, status) => request(`/api/campaigns/${id}/status`, { method: 'POST', body: { status } }),
  enroll: (id, body) => request(`/api/campaigns/${id}/enroll`, { method: 'POST', body }),
  enrollments: (id, q = '') => request(`/api/campaigns/${id}/enrollments${q}`),
  markReplied: (enrollmentId) => request(`/api/campaigns/enrollments/${enrollmentId}/replied`, { method: 'POST' }),
  preview: (id, body) => request(`/api/campaigns/${id}/preview`, { method: 'POST', body }),
  testSend: (id, body) => request(`/api/campaigns/${id}/test`, { method: 'POST', body }),
  messages: (id) => request(`/api/campaigns/${id}/messages`),

  // contact finder (scraper)
  scrapeRun: (sites) => request('/api/scrape/run', { method: 'POST', body: { sites } }),
  scrapeUpload: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('/api/scrape/run', { method: 'POST', body: fd, isForm: true });
  },
  directory: (q = '') => request(`/api/scrape/directory${q}`),
  directoryCities: () => request('/api/scrape/directory/cities'),
  scrapeJobs: () => request('/api/scrape/jobs'),
  scrapeJob: (id) => request(`/api/scrape/jobs/${id}`),
  scrapeImport: (id, body) => request(`/api/scrape/jobs/${id}/import`, { method: 'POST', body }),

  // ops
  opsStatus: () => request('/api/campaigns/ops/status'),
  tick: () => request('/api/campaigns/ops/tick', { method: 'POST' }),
};
