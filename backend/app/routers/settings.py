import base64
from datetime import datetime, timedelta
import hmac
import json
import secrets
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.schemas import (
    LogoReprocessPayload,
    LogoScalePayload,
    PinVerifyPayload,
    SettingsOut,
    SettingsPayload,
)
from app.security import (
    check_rate_limit,
    create_admin_token,
    require_admin_auth,
)
from app.services.logo_processor import remove_background_and_optimize
from app.services.telegram_service import (
    _record_seen_chat,
    get_setting,
    get_telegram_message_config,
    process_telegram_update,
    save_telegram_message_config,
    set_setting,
)
from app.services.ws_manager import ws_manager

router = APIRouter(prefix="/api", tags=["settings"])

MAX_LOGO_BYTES = 8 * 1024 * 1024  # 8 MB


def _mask_token(token: str) -> str:
    if not token:
        return ""
    if len(token) <= 12:
        return "*" * len(token)
    return f"{token[:6]}...{token[-4:]}"


@router.post("/auth/verify-pin")
def verify_dynamic_pin(payload: PinVerifyPayload, request: Request):
    """
    Türkiye saatine (Europe/Istanbul) göre GGAAssdd (Gün-Ay-Saat-Dakika, örn: 18111323)
    formatında anlık 8 haneli PIN doğrulaması yapar.
    Çerez (cookie) yazmaz; yalnızca tarayıcı RAM belleğinde tutulacak imzalı jeton döner.
    """
    check_rate_limit(request, "pin_verify", max_requests=10, window_seconds=60)

    now_tr = datetime.now(ZoneInfo("Europe/Istanbul"))
    expected_now = now_tr.strftime("%d%m%H%M")

    candidates = [expected_now]
    if now_tr.second <= 15:
        prev_min = (now_tr - timedelta(minutes=1)).strftime("%d%m%H%M")
        candidates.append(prev_min)

    entered = payload.pin.strip()
    is_valid = any(hmac.compare_digest(entered, cand) for cand in candidates)
    if not is_valid:
        raise HTTPException(
            status_code=401, detail="PIN kodu hatalı veya süresi geçti."
        )

    return {"ok": True, "token": create_admin_token()}


@router.get(
    "/settings",
    response_model=SettingsOut,
    dependencies=[Depends(require_admin_auth)],
)
def read_settings(db: Session = Depends(get_db)):
    token = get_setting(db, "telegram_bot_token", "")
    chat_id = get_setting(db, "telegram_chat_id", "")
    public_url = get_setting(db, "public_base_url", settings.DEFAULT_PUBLIC_BASE_URL)
    company_name = get_setting(db, "company_name", "Dikişhane Komponent Rafı")
    logo_data_url = get_setting(db, "company_logo_data_url", "").strip() or None

    raw_scale = get_setting(db, "company_logo_scale", "100")
    try:
        logo_scale = max(40, min(260, int(raw_scale)))
    except ValueError:
        logo_scale = 100

    raw_meta = get_setting(db, "company_logo_meta", "")
    try:
        logo_meta = json.loads(raw_meta) if raw_meta else None
    except Exception:
        logo_meta = None

    raw_chats = get_setting(db, "telegram_recent_chats", "[]")
    try:
        recent_chats = json.loads(raw_chats)
    except Exception:
        recent_chats = []

    msg_cfg = get_telegram_message_config(db)
    polling_status = get_setting(db, "telegram_polling_status", "idle")
    polling_detail = get_setting(db, "telegram_polling_detail", "") or None

    return SettingsOut(
        telegram_bot_token_masked=_mask_token(token),
        telegram_bot_token_configured=bool(token.strip()),
        telegram_chat_id=chat_id,
        public_base_url=public_url,
        company_name=company_name,
        company_logo_data_url=logo_data_url,
        company_logo_scale=logo_scale,
        company_logo_meta=logo_meta,
        telegram_message_config=msg_cfg,
        telegram_polling_status=polling_status,
        telegram_polling_detail=polling_detail,
        recent_chats=recent_chats,
    )


@router.put(
    "/settings",
    response_model=SettingsOut,
    dependencies=[Depends(require_admin_auth)],
)
async def update_settings(payload: SettingsPayload, db: Session = Depends(get_db)):
    incoming_token = payload.telegram_bot_token.strip()
    if incoming_token and "..." not in incoming_token and incoming_token != "__CLEAR__":
        old_token = get_setting(db, "telegram_bot_token", "").strip()
        if incoming_token != old_token:
            set_setting(db, "telegram_last_update_id", "0")
            set_setting(db, "telegram_polling_status", "idle")
            set_setting(db, "telegram_polling_detail", "")
        set_setting(db, "telegram_bot_token", incoming_token)
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                await client.post(f"https://api.telegram.org/bot{incoming_token}/deleteWebhook")
        except Exception:
            pass

    if payload.telegram_bot_token == "__CLEAR__":
        set_setting(db, "telegram_bot_token", "")

    set_setting(db, "telegram_chat_id", payload.telegram_chat_id.strip())
    clean_url = payload.public_base_url.strip().rstrip("/")
    if clean_url:
        set_setting(db, "public_base_url", clean_url)
    set_setting(db, "company_name", payload.company_name.strip() or "Dikişhane Komponent Rafı")

    if payload.telegram_message_config is not None:
        save_telegram_message_config(db, payload.telegram_message_config)

    db.commit()
    await ws_manager.broadcast("SETTINGS_UPDATED", {"action": "UPDATED"})
    return read_settings(db)


@router.post(
    "/settings/logo",
    response_model=SettingsOut,
    dependencies=[Depends(require_admin_auth)],
)
async def upload_company_logo(
    file: UploadFile = File(...),
    remove_bg: str = Form(default="auto"),
    tolerance: int = Form(default=32),
    db: Session = Depends(get_db),
):
    content_type = (file.content_type or "").lower().strip()
    filename = (file.filename or "").lower()

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Boş dosya yüklendi.")
    if len(raw_bytes) > MAX_LOGO_BYTES:
        raise HTTPException(
            status_code=400,
            detail="Logo dosyası en fazla 8 MB olabilir.",
        )

    if content_type == "image/svg+xml" or filename.endswith(".svg"):
        encoded = base64.b64encode(raw_bytes).decode("ascii")
        data_url = f"data:image/svg+xml;base64,{encoded}"
        meta = {
            "original_format": "SVG",
            "already_transparent": True,
            "bg_removed": False,
            "detected_bg_hex": None,
        }
        set_setting(db, "company_logo_raw_b64", "")
        set_setting(db, "company_logo_data_url", data_url)
        set_setting(db, "company_logo_meta", json.dumps(meta, ensure_ascii=False))
    else:
        try:
            data_url, meta = remove_background_and_optimize(
                raw_bytes,
                force_remove_bg=remove_bg if remove_bg in ("auto", "always", "never") else "auto",
                tolerance=tolerance,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Görsel işlenemedi. Lütfen PNG, JPG veya WebP formatında geçerli bir logo seçin ({exc}).",
            ) from exc

        meta["tolerance"] = tolerance
        meta["mode"] = remove_bg
        set_setting(db, "company_logo_raw_b64", base64.b64encode(raw_bytes).decode("ascii"))
        set_setting(db, "company_logo_data_url", data_url)
        set_setting(db, "company_logo_meta", json.dumps(meta, ensure_ascii=False))

    db.commit()
    await ws_manager.broadcast("SETTINGS_UPDATED", {"action": "LOGO_UPDATED"})
    return read_settings(db)


@router.post(
    "/settings/logo/reprocess",
    response_model=SettingsOut,
    dependencies=[Depends(require_admin_auth)],
)
async def reprocess_company_logo(
    payload: LogoReprocessPayload,
    db: Session = Depends(get_db),
):
    raw_b64 = get_setting(db, "company_logo_raw_b64", "").strip()
    if not raw_b64:
        existing_url = get_setting(db, "company_logo_data_url", "").strip()
        if not existing_url or "," not in existing_url:
            raise HTTPException(
                status_code=400,
                detail="Yeniden işlenecek kayıtlı bir logo bulunamadı.",
            )
        raw_b64 = existing_url.split(",", 1)[1]
        set_setting(db, "company_logo_raw_b64", raw_b64)

    raw_bytes = base64.b64decode(raw_b64)
    data_url, meta = remove_background_and_optimize(
        raw_bytes,
        force_remove_bg=payload.remove_bg,
        tolerance=payload.tolerance,
    )
    meta["tolerance"] = payload.tolerance
    meta["mode"] = payload.remove_bg
    set_setting(db, "company_logo_data_url", data_url)
    set_setting(db, "company_logo_meta", json.dumps(meta, ensure_ascii=False))
    db.commit()

    await ws_manager.broadcast("SETTINGS_UPDATED", {"action": "LOGO_REPROCESSED"})
    return read_settings(db)


@router.patch(
    "/settings/logo-scale",
    response_model=SettingsOut,
    dependencies=[Depends(require_admin_auth)],
)
async def update_company_logo_scale(
    payload: LogoScalePayload,
    db: Session = Depends(get_db),
):
    set_setting(db, "company_logo_scale", str(payload.logo_scale))
    db.commit()
    await ws_manager.broadcast(
        "SETTINGS_UPDATED",
        {"action": "LOGO_SCALE_UPDATED", "logo_scale": payload.logo_scale},
    )
    return read_settings(db)


@router.delete(
    "/settings/logo",
    response_model=SettingsOut,
    dependencies=[Depends(require_admin_auth)],
)
async def remove_company_logo(db: Session = Depends(get_db)):
    set_setting(db, "company_logo_data_url", "")
    set_setting(db, "company_logo_raw_b64", "")
    set_setting(db, "company_logo_meta", "")
    db.commit()
    await ws_manager.broadcast("SETTINGS_UPDATED", {"action": "LOGO_REMOVED"})
    return read_settings(db)


@router.post(
    "/settings/discover-chats",
    dependencies=[Depends(require_admin_auth)],
)
async def discover_telegram_chats(db: Session = Depends(get_db)):
    token = get_setting(db, "telegram_bot_token", "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Önce Telegram Bot Token kaydedin.")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            me_resp = await client.get(f"https://api.telegram.org/bot{token}/getMe")
            me_data = me_resp.json()
            if not me_data.get("ok"):
                raise HTTPException(
                    status_code=400,
                    detail=f"Bot Token geçersiz: {me_data.get('description', 'Bilinmeyen hata')}",
                )
            bot_info = me_data.get("result", {})

            upd_resp = await client.get(
                f"https://api.telegram.org/bot{token}/getUpdates",
                params={"timeout": 1},
            )
            if upd_resp.status_code == 200:
                upd_json = upd_resp.json()
                for upd in upd_json.get("result", []):
                    if "message" in upd and isinstance(upd["message"], dict):
                        _record_seen_chat(db, upd["message"].get("chat", {}))
                    elif "my_chat_member" in upd and isinstance(upd["my_chat_member"], dict):
                        _record_seen_chat(db, upd["my_chat_member"].get("chat", {}))
                db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Telegram bağlantı hatası: {exc}") from exc

    raw_chats = get_setting(db, "telegram_recent_chats", "[]")
    try:
        recent_chats = json.loads(raw_chats)
    except Exception:
        recent_chats = []

    return {
        "ok": True,
        "bot_username": bot_info.get("username"),
        "bot_name": bot_info.get("first_name"),
        "recent_chats": recent_chats,
    }


@router.post(
    "/settings/telegram-test",
    dependencies=[Depends(require_admin_auth)],
)
async def send_telegram_test_message(db: Session = Depends(get_db)):
    token = get_setting(db, "telegram_bot_token", "").strip()
    chat_id = get_setting(db, "telegram_chat_id", "").strip()

    if not token or not chat_id:
        raise HTTPException(
            status_code=400,
            detail="Test mesajı için hem Telegram Bot Token hem de Grup Chat ID kayıtlı olmalıdır.",
        )

    text = (
        "✅ <b>KOMPONENT RAF SİSTEMİ BAĞLANTI TESTİ</b>\n\n"
        "Dikişhane QR etiket talep sistemi bu Telegram grubuna başarıyla bağlandı!\n"
        "Operatörler raftaki QR kodu okuttuğunda talepler buraya düşecektir."
    )
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
        )
        data = resp.json()
        if resp.status_code != 200 or not data.get("ok"):
            raise HTTPException(
                status_code=400,
                detail=f"Telegram mesajı gönderilemedi: {data.get('description', resp.text)}",
            )

    return {"ok": True, "message": "Test mesajı Telegram grubuna başarıyla gönderildi!"}


@router.post("/telegram/webhook/{secret_slug}")
async def telegram_webhook(
    secret_slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    expected = get_setting(db, "telegram_webhook_secret", "").strip()
    if not expected:
        expected = secrets.token_urlsafe(24)
        set_setting(db, "telegram_webhook_secret", expected)
        db.commit()

    if not hmac.compare_digest(secret_slug, expected):
        raise HTTPException(status_code=403, detail="Geçersiz webhook anahtarı.")

    update = await request.json()
    await process_telegram_update(update)
    return {"ok": True}
