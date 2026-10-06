// Renvara CRM · browser API client. All CRM data lives on the server
// (apps/beta-web/src/crm); pages call these functions and never store records.

export class ApiError extends Error {
  constructor(status, message, errors = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    /** { field: message } from the server's validation (422). */
    this.errors = errors;
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
    throw new ApiError(response.status, payload.message ?? NETWORK_ERROR, payload.errors ?? {});
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
  searchCustomers: (q) => request('GET', `/api/customers${query({ q })}`).then((r) => r.customers),
  getCustomer: (id) => request('GET', `/api/customers/${enc(id)}`).then((r) => r.customer),
  createCustomer: (input) => request('POST', '/api/customers', input).then((r) => r.customer),
  updateCustomer: (id, input) =>
    request('PATCH', `/api/customers/${enc(id)}`, input).then((r) => r.customer),
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
  pipeline: () => request('GET', '/api/pipeline').then((r) => r.stages),
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
  // Sales Calendar: tasks scheduled in [from, to)
  calendar: (from, to) =>
    request(
      'GET',
      `/api/calendar${query({ from: from.toISOString(), to: to.toISOString() })}`,
    ).then((r) => r.tasks),
  resetDemo: () => request('POST', '/api/demo/reset', {}),
};
