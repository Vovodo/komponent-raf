import type {
  AppSettings,
  BulkImportResult,
  BulkImportRow,
  ComponentItem,
  DashboardStats,
  RecentTelegramChat,
  ReplenishmentRequest,
  ScanTriggerResponse,
  Section,
  TelegramMessageConfig,
} from './types';

// Çerez, localStorage veya sessionStorage KULLANILMAZ; yalnızca açık sekmenin anlık RAM belleğinde tutulur.
let inMemoryAdminToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function getAdminMemoryToken(): string | null {
  return inMemoryAdminToken;
}

export function setAdminMemoryToken(token: string | null): void {
  inMemoryAdminToken = token;
}

export function setOnUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const isFormData = options?.body instanceof FormData;
  const headers: Record<string, string> = isFormData
    ? {}
    : { 'Content-Type': 'application/json' };

  if (inMemoryAdminToken) {
    headers['X-Admin-Token'] = inMemoryAdminToken;
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...((options?.headers as Record<string, string>) || {}),
    },
  });

  if (res.status === 401 && !url.includes('/api/auth/verify-pin')) {
    inMemoryAdminToken = null;
    if (unauthorizedHandler) unauthorizedHandler();
  }

  if (!res.ok) {
    let errMsg = `Sunucu hatası (${res.status})`;
    try {
      const errBody = await res.json();
      if (errBody?.detail) {
        errMsg =
          typeof errBody.detail === 'string'
            ? errBody.detail
            : JSON.stringify(errBody.detail);
      }
    } catch {
      // ignore json parse failure
    }
    throw new Error(errMsg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  verifyPin: async (pin: string) => {
    const res = await requestJson<{ ok: boolean; token: string }>(
      '/api/auth/verify-pin',
      {
        method: 'POST',
        body: JSON.stringify({ pin }),
      }
    );
    setAdminMemoryToken(res.token);
    return res;
  },

  getStats: () => requestJson<DashboardStats>('/api/stats'),

  getSections: () => requestJson<Section[]>('/api/sections'),

  createSection: (data: {
    name: string;
    short_code: string;
    color_hex: string;
    emoji: string;
    sort_order?: number;
  }) =>
    requestJson<Section>('/api/sections', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateSection: (
    id: number,
    data: Partial<{
      name: string;
      short_code: string;
      color_hex: string;
      emoji: string;
      sort_order: number;
    }>
  ) =>
    requestJson<Section>(`/api/sections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteSection: (id: number) =>
    requestJson<{ ok: boolean }>(`/api/sections/${id}`, {
      method: 'DELETE',
    }),

  getItems: (params?: { section_id?: number | null; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.section_id) qs.set('section_id', String(params.section_id));
    if (params?.search?.trim()) qs.set('search', params.search.trim());
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return requestJson<ComponentItem[]>(`/api/items${suffix}`);
  },

  createItems: (data: {
    reference_code: string;
    description: string;
    section_ids: number[];
    shelf_code?: string;
    unit_info?: string;
  }) =>
    requestJson<ComponentItem[]>('/api/items', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateItem: (
    id: number,
    data: Partial<{
      reference_code: string;
      description: string;
      section_id: number | null;
      shelf_code: string;
      unit_info: string;
      is_active: boolean;
    }>
  ) =>
    requestJson<ComponentItem>(`/api/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  bulkAssignSection: (ids: number[], section_id: number | null) =>
    requestJson<{ updated: number; skipped: number }>(
      '/api/items/bulk-assign-section',
      {
        method: 'POST',
        body: JSON.stringify({ ids, section_id }),
      }
    ),

  deleteItem: (id: number) =>
    requestJson<{ ok: boolean }>(`/api/items/${id}`, {
      method: 'DELETE',
    }),

  bulkDeleteItems: (ids: number[]) =>
    requestJson<{ deleted: number }>('/api/items/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  bulkImportItems: (default_section_id: number | null, rows: BulkImportRow[]) =>
    requestJson<BulkImportResult>('/api/items/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ default_section_id, rows }),
    }),

  seedDemoItems: () =>
    requestJson<ComponentItem[]>('/api/items/seed-demo', {
      method: 'POST',
    }),

  triggerScan: (qrToken: string) =>
    requestJson<ScanTriggerResponse>(
      `/api/scan/${encodeURIComponent(qrToken)}`,
      {
        method: 'POST',
      }
    ),

  getQrItemStatus: (qrToken: string) =>
    requestJson<ComponentItem>(
      `/api/scan/${encodeURIComponent(qrToken)}/status`
    ),

  getRequests: (params?: { status?: string; section_id?: number | null }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.section_id) qs.set('section_id', String(params.section_id));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return requestJson<ReplenishmentRequest[]>(`/api/requests${suffix}`);
  },

  getSingleRequest: (reqId: number) =>
    requestJson<ReplenishmentRequest>(`/api/requests/${reqId}`),

  completeRequest: (reqId: number, completed_by = 'Depo Paneli') =>
    requestJson<ReplenishmentRequest>(`/api/requests/${reqId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ completed_by }),
    }),

  cancelRequest: (reqId: number) =>
    requestJson<ReplenishmentRequest>(`/api/requests/${reqId}/cancel`, {
      method: 'POST',
    }),

  completeAllPendingRequests: (completed_by = 'Uygulama Paneli') =>
    requestJson<{ completed_count: number }>('/api/requests/complete-all', {
      method: 'POST',
      body: JSON.stringify({ completed_by }),
    }),

  retryTelegram: (reqId: number) =>
    requestJson<ReplenishmentRequest>(
      `/api/requests/${reqId}/retry-telegram`,
      {
        method: 'POST',
      }
    ),

  getSettings: () => requestJson<AppSettings>('/api/settings'),

  saveSettings: (data: {
    telegram_bot_token: string;
    telegram_chat_id: string;
    public_base_url: string;
    company_name: string;
    telegram_message_config?: TelegramMessageConfig;
  }) =>
    requestJson<AppSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  uploadCompanyLogo: (
    file: File,
    options?: { remove_bg?: 'auto' | 'always' | 'never'; tolerance?: number }
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('remove_bg', options?.remove_bg ?? 'auto');
    formData.append('tolerance', String(options?.tolerance ?? 32));
    return requestJson<AppSettings>('/api/settings/logo', {
      method: 'POST',
      body: formData,
    });
  },

  reprocessCompanyLogo: (
    remove_bg: 'auto' | 'always' | 'never',
    tolerance: number
  ) =>
    requestJson<AppSettings>('/api/settings/logo/reprocess', {
      method: 'POST',
      body: JSON.stringify({ remove_bg, tolerance }),
    }),

  updateCompanyLogoScale: (logo_scale: number) =>
    requestJson<AppSettings>('/api/settings/logo-scale', {
      method: 'PATCH',
      body: JSON.stringify({ logo_scale }),
    }),

  removeCompanyLogo: () =>
    requestJson<AppSettings>('/api/settings/logo', {
      method: 'DELETE',
    }),

  discoverTelegramChats: () =>
    requestJson<{
      ok: boolean;
      bot_username?: string;
      bot_name?: string;
      recent_chats: RecentTelegramChat[];
    }>('/api/settings/discover-chats', {
      method: 'POST',
    }),

  sendTelegramTest: () =>
    requestJson<{ ok: boolean; message: string }>(
      '/api/settings/telegram-test',
      {
        method: 'POST',
      }
    ),
};
