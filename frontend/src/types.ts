export interface Section {
  id: number;
  slug: string;
  name: string;
  short_code: string;
  color_hex: string;
  emoji: string;
  sort_order: number;
  item_count: number;
}

export interface ComponentItem {
  id: number;
  reference_code: string;
  description: string;
  section_id: number | null;
  section: Section | null;
  shelf_code: string | null;
  unit_info: string | null;
  qr_token: string;
  is_active: boolean;
  has_pending_request: boolean;
  pending_request_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ReplenishmentRequest {
  id: number;
  item_id: number;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  telegram_sent: boolean;
  telegram_error: string | null;
  scan_count: number;
  requested_at: string;
  last_scanned_at: string;
  completed_at: string | null;
  completed_by: string | null;
  item: ComponentItem;
}

export interface ScanTriggerResponse {
  outcome: 'CREATED' | 'ALREADY_PENDING';
  message: string;
  request: ReplenishmentRequest;
}

export interface DashboardStats {
  total_items: number;
  pending_requests: number;
  completed_today: number;
  avg_completion_minutes: number | null;
}

export interface RecentTelegramChat {
  id: string;
  title: string;
  type: string;
}

export interface CompanyLogoMeta {
  original_format?: string;
  already_transparent?: boolean;
  bg_removed?: boolean;
  detected_bg_hex?: string | null;
  width?: number;
  height?: number;
  tolerance?: number;
  mode?: string;
}

export interface TelegramMessageConfig {
  show_title: boolean;
  show_section: boolean;
  show_reference: boolean;
  show_description: boolean;
  show_shelf: boolean;
  show_unit: boolean;
  show_time: boolean;
  show_footer_hint: boolean;
  show_complete_button: boolean;
  show_completed_by: boolean;
  button_mode: 'auto' | 'callback' | 'web_url';
  custom_prefix: string;
}

export interface AppSettings {
  telegram_bot_token_masked: string;
  telegram_bot_token_configured: boolean;
  telegram_chat_id: string;
  public_base_url: string;
  company_name: string;
  company_logo_data_url: string | null;
  company_logo_scale: number;
  company_logo_meta: CompanyLogoMeta | null;
  telegram_message_config: TelegramMessageConfig;
  telegram_polling_status: string;
  telegram_polling_detail: string | null;
  recent_chats: RecentTelegramChat[];
}

export interface BulkImportRow {
  reference_code: string;
  description: string;
  section_name?: string;
  shelf_code?: string;
  unit_info?: string;
}

export interface BulkImportResult {
  created_count: number;
  updated_count: number;
  skipped_count: number;
  errors: string[];
}

export interface RealtimeWsEvent {
  type:
    | 'CONNECTED'
    | 'PONG'
    | 'REQUEST_UPDATED'
    | 'CATALOG_UPDATED'
    | 'SETTINGS_UPDATED';
  timestamp?: string;
  payload?: Record<string, unknown>;
}
