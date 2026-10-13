// Renvara CRM · browser API client. All CRM data lives on the server
// (apps/beta-web/src/crm); pages call these functions and never store records.

export class ApiError extends Error {
  constructor(status, message, errors = {}, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    /** { field: message } from the server's validation (422). */
    this.errors = errors;
    /** Anything else the server explained, e.g. { matches } with a 409. */
    this.details = details;
  }
}

const NETWORK_ERROR = 'Nije moguće povezati se sa serverom. Pokušajte ponovno.';

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR);
  }
  if (response.status === 401) {
    window.location.replace('/login?reason=expired');
    throw new ApiError(401, 'Sesija je istekla.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const { success, message, errors, ...details } = payload;
    throw new ApiError(response.status, message ?? NETWORK_ERROR, errors ?? {}, details);
  }
  notifyChange(method);
  return payload;
}

const query = (params) => {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
};
const enc = encodeURIComponent;

// Other open tabs refresh when this one changes data.
let channel = null;
try {
  channel = new BroadcastChannel('renvara-crm');
} catch {
  // Unsupported, or refused in a sandboxed frame: other tabs refresh on their next load.
}
function notifyChange(method) {
  if (method !== 'GET') channel?.postMessage('changed');
}

/** Runs `listener` when CRM data may have changed elsewhere (another tab, or Back to a cached page). */
export function onDataChanged(listener) {
  channel?.addEventListener('message', listener);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) listener();
  });
}

export const api = {
  // customers
  /** status: 'active' | 'inactive' | 'all' (default: every customer, as pickers need). */
  searchCustomers: (q, status = 'all') =>
    request('GET', `/api/customers${query({ q, status })}`).then((r) => r.customers),
  getCustomer: (id) => request('GET', `/api/customers/${enc(id)}`).then((r) => r.customer),
  createCustomer: (input) => request('POST', '/api/customers', input).then((r) => r.customer),
  updateCustomer: (id, input) =>
    request('PATCH', `/api/customers/${enc(id)}`, input).then((r) => r.customer),
  deactivateCustomer: (id) =>
    request('POST', `/api/customers/${enc(id)}/deactivate`, {}).then((r) => r.customer),
  activateCustomer: (id) =>
    request('POST', `/api/customers/${enc(id)}/activate`, {}).then((r) => r.customer),
  addNote: (id, input) => request('POST', `/api/customers/${enc(id)}/notes`, input),
  logEmail: (id, input) => request('POST', `/api/customers/${enc(id)}/emails`, input),
  // contacts
  listContacts: (companyId) =>
    request('GET', `/api/contacts${query({ companyId })}`).then((r) => r.contacts),
  createContact: (input) => request('POST', '/api/contacts', input).then((r) => r.contact),
  // opportunities
  listOpportunities: (filter = {}) =>
    request('GET', `/api/opportunities${query(filter)}`).then((r) => r.opportunities),
  getOpportunity: (id) =>
    request('GET', `/api/opportunities/${enc(id)}`).then((r) => r.opportunity),
  createOpportunity: (input) => request('POST', '/api/opportunities', input),
  /** Stage totals; `{ from, to }` limits them to opportunities created in that period. */
  pipeline: (period = {}) => request('GET', `/api/pipeline${query(period)}`).then((r) => r.stages),
  // tasks
  listTasks: (filter = {}) => request('GET', `/api/tasks${query(filter)}`).then((r) => r.tasks),
  taskSections: () => request('GET', '/api/tasks/sections').then((r) => r.sections),
  priorities: () => request('GET', '/api/tasks/priorities').then((r) => r.tasks),
  getTask: (id) => request('GET', `/api/tasks/${enc(id)}`).then((r) => r.task),
  createTask: (input) => request('POST', '/api/tasks', input).then((r) => r.task),
  updateTask: (id, input) => request('PATCH', `/api/tasks/${enc(id)}`, input).then((r) => r.task),
  completeTask: (id) => request('POST', `/api/tasks/${enc(id)}/complete`, {}).then((r) => r.task),
  reopenTask: (id) => request('POST', `/api/tasks/${enc(id)}/reopen`, {}).then((r) => r.task),
  cancelTask: (id) => request('POST', `/api/tasks/${enc(id)}/cancel`, {}).then((r) => r.task),
  // leads (separate from customers; converted or lost, never deleted)
  listLeads: (filter = {}) => request('GET', `/api/leads${query(filter)}`).then((r) => r.leads),
  getLead: (id) => request('GET', `/api/leads/${enc(id)}`).then((r) => r.lead),
  createLead: (input) => request('POST', '/api/leads', input).then((r) => r.lead),
  updateLead: (id, input) => request('PATCH', `/api/leads/${enc(id)}`, input).then((r) => r.lead),
  leadMatches: (id) => request('GET', `/api/leads/${enc(id)}/matches`).then((r) => r.matches),
  convertLead: (id, input) => request('POST', `/api/leads/${enc(id)}/convert`, input),
  markLeadLost: (id, input) =>
    request('POST', `/api/leads/${enc(id)}/lost`, input).then((r) => r.lead),
  // reminders (null removes) and this device's push subscription
  setReminder: (kind, id, reminderAt) =>
    request('PUT', `/api/${kind}/${enc(id)}/reminder`, { reminderAt }).then((r) => r.reminder),
  pushStatus: () => request('GET', '/api/push/status'),
  // FEEDBACK OVERVIEW / PONUDE: offers created in a period, with their standing
  offersOverview: (from, to, status = 'all') =>
    request('GET', `/api/offers${query({ from, to, status })}`).then((r) => r.overview),
  subscribePush: (input) => request('POST', '/api/push/subscriptions', input),
  testPush: () => request('POST', '/api/push/test', {}),
  // opportunities: close, offers
  closeOpportunity: (id, input) =>
    request('POST', `/api/opportunities/${enc(id)}/close`, input).then((r) => r.opportunity),
  recordOffer: (input) => request('POST', '/api/offers', input).then((r) => r.offer),
  offerAnswered: (id) =>
    request('POST', `/api/offers/${enc(id)}/answered`, {}).then((r) => r.offer),
  // Sales Calendar: tasks scheduled in [from, to)
  calendar: (from, to) =>
    request(
      'GET',
      `/api/calendar${query({ from: from.toISOString(), to: to.toISOString() })}`,
    ).then((r) => r.tasks),
  // Home dashboard: one period, calendar dates inclusive
  dashboardSummary: (from, to) =>
    request('GET', `/api/dashboard/summary${query({ from, to })}`).then((r) => r.summary),
  resetDemo: () => request('POST', '/api/demo/reset', {}),
  // Follow-up Engine: offer PDFs, share links, engagement (ADR-0008)
  followUpOffers: (filter = 'all') => request('GET', `/api/follow-up/offers${query({ filter })}`),
  followUpOffer: (id) => request('GET', `/api/follow-up/offers/${enc(id)}`).then((r) => r.offer),
  createFollowUpOffer: (input) =>
    request('POST', '/api/follow-up/offers', input).then((r) => r.offer),
  markFollowUpSent: (id, sentAt) =>
    request('POST', `/api/follow-up/offers/${enc(id)}/sent`, { sentAt }).then((r) => r.offer),
  markFollowUpAnswered: (id) =>
    request('POST', `/api/follow-up/offers/${enc(id)}/answered`, {}).then((r) => r.offer),
  revokeFollowUpLink: (id) =>
    request('POST', `/api/follow-up/offers/${enc(id)}/link/revoke`, {}).then((r) => r.offer),
  issueFollowUpLink: (id) =>
    request('POST', `/api/follow-up/offers/${enc(id)}/link`, {}).then((r) => r.offer),
  /** The PDF for the salesperson's own preview (not counted as a customer view). */
  async followUpDocument(id) {
    let response;
    try {
      response = await fetch(`/api/follow-up/offers/${enc(id)}/document`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(0, NETWORK_ERROR);
    }
    if (response.status === 401) {
      window.location.replace('/login?reason=expired');
      throw new ApiError(401, 'Sesija je istekla.');
    }
    if (!response.ok) throw new ApiError(response.status, 'Dokument trenutno nije dostupan.');
    return response.arrayBuffer();
  },
  uploadOfferDocument,
};

/**
 * Uploads a picked PDF as the raw request body. `onProgress(0…1)` while it
 * travels (XMLHttpRequest; the in-browser demo has no network, so fetch).
 */
function uploadOfferDocument(file, onProgress = () => {}) {
  const path = '/api/follow-up/uploads';
  const headers = {
    'Content-Type': 'application/pdf',
    'X-File-Name': encodeURIComponent(file.name ?? 'ponuda.pdf'),
    Accept: 'application/json',
  };
  const settle = (status, payload) => {
    if (status === 401) {
      window.location.replace('/login?reason=expired');
      throw new ApiError(401, 'Sesija je istekla.');
    }
    if (status < 200 || status >= 300 || payload.success === false) {
      const { success, message, errors, ...details } = payload;
      throw new ApiError(status, message ?? NETWORK_ERROR, errors ?? {}, details);
    }
    return payload.upload;
  };
  if (globalThis.__rv || typeof XMLHttpRequest === 'undefined') {
    return fetch(path, { method: 'POST', headers, body: file, credentials: 'same-origin' })
      .catch(() => {
        throw new ApiError(0, NETWORK_ERROR);
      })
      .then(async (response) => {
        onProgress(1);
        return settle(response.status, await response.json().catch(() => ({})));
      });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON: a proxy or network error page */
      }
      try {
        resolve(settle(xhr.status, payload));
      } catch (error) {
        reject(error);
      }
    });
    xhr.addEventListener('error', () => reject(new ApiError(0, NETWORK_ERROR)));
    xhr.addEventListener('abort', () => reject(new ApiError(0, NETWORK_ERROR)));
    xhr.send(file);
  });
}
