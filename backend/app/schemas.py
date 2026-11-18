from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class SectionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    short_code: str = Field(..., min_length=1, max_length=16)
    color_hex: str = Field(..., pattern=r"^#[0-9A-Fa-f]{6}$")
    emoji: str = Field(default="🟦", max_length=16)
    sort_order: int = 0


class SectionCreate(SectionBase):
    slug: str | None = None


class SectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    short_code: str | None = Field(default=None, min_length=1, max_length=16)
    color_hex: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    emoji: str | None = Field(default=None, max_length=16)
    sort_order: int | None = None


class SectionOut(SectionBase):
    id: int
    slug: str
    item_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ComponentItemCreate(BaseModel):
    reference_code: str = Field(..., min_length=1, max_length=100)
    description: str = Field(..., min_length=1, max_length=300)
    section_ids: list[int] = Field(default_factory=list)
    shelf_code: str | None = Field(default=None, max_length=60)
    unit_info: str | None = Field(default=None, max_length=80)


class ComponentItemUpdate(BaseModel):
    reference_code: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, min_length=1, max_length=300)
    section_id: int | None = None
    shelf_code: str | None = Field(default=None, max_length=60)
    unit_info: str | None = Field(default=None, max_length=80)
    is_active: bool | None = None


class ComponentItemOut(BaseModel):
    id: int
    reference_code: str
    description: str
    section_id: int | None = None
    section: SectionOut | None = None
    shelf_code: str | None = None
    unit_info: str | None = None
    qr_token: str
    is_active: bool
    has_pending_request: bool = False
    pending_request_id: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BulkImportRow(BaseModel):
    reference_code: str
    description: str
    section_name: str | None = None
    shelf_code: str | None = None
    unit_info: str | None = None


class BulkImportRequest(BaseModel):
    default_section_id: int | None = None
    rows: list[BulkImportRow]


class BulkImportResult(BaseModel):
    created_count: int
    updated_count: int
    skipped_count: int
    errors: list[str] = []


class ReplenishmentRequestOut(BaseModel):
    id: int
    item_id: int
    status: str
    telegram_sent: bool
    telegram_error: str | None = None
    scan_count: int
    requested_at: datetime
    last_scanned_at: datetime
    completed_at: datetime | None = None
    completed_by: str | None = None
    item: ComponentItemOut

    model_config = ConfigDict(from_attributes=True)


class ScanTriggerResponse(BaseModel):
    outcome: str  # "CREATED" | "ALREADY_PENDING"
    message: str
    request: ReplenishmentRequestOut


class CompleteRequestPayload(BaseModel):
    completed_by: str = "Depo Paneli"


class TelegramMessageConfig(BaseModel):
    show_title: bool = False
    show_section: bool = False
    show_reference: bool = True
    show_description: bool = False
    show_shelf: bool = False
    show_unit: bool = False
    show_time: bool = False
    show_footer_hint: bool = False
    show_complete_button: bool = True
    show_completed_by: bool = True
    button_mode: str = Field(default="auto", pattern=r"^(auto|callback|web_url)$")
    custom_prefix: str = Field(default="", max_length=120)


class PinVerifyPayload(BaseModel):
    pin: str = Field(..., min_length=8, max_length=8)


class SettingsPayload(BaseModel):
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    public_base_url: str = ""
    company_name: str = "Dikişhane Komponent Rafı"
    telegram_message_config: TelegramMessageConfig | None = None


class LogoReprocessPayload(BaseModel):
    remove_bg: str = Field(default="auto", pattern=r"^(auto|always|never)$")
    tolerance: int = Field(default=32, ge=8, le=95)


class LogoScalePayload(BaseModel):
    logo_scale: int = Field(..., ge=40, le=260)


class SettingsOut(BaseModel):
    telegram_bot_token_masked: str
    telegram_bot_token_configured: bool
    telegram_chat_id: str
    public_base_url: str
    company_name: str
    company_logo_data_url: str | None = None
    company_logo_scale: int = 100
    company_logo_meta: dict | None = None
    telegram_message_config: TelegramMessageConfig
    telegram_polling_status: str = "idle"
    telegram_polling_detail: str | None = None
    recent_chats: list[dict] = []


class DashboardStats(BaseModel):
    total_items: int
    pending_requests: int
    completed_today: int
    avg_completion_minutes: float | None = None
