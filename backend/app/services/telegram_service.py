import asyncio
from datetime import datetime
import html
import json
import logging
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import SessionLocal
from app.models import AppSetting, ComponentItem, ReplenishmentRequest, utc_now
from app.schemas import TelegramMessageConfig
from app.security import parse_and_verify_telegram_callback, sign_telegram_callback
from app.services.ws_manager import ws_manager

logger = logging.getLogger("komponent_raf.telegram")
ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")


def get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.get(AppSetting, key)
    return row.value if row and row.value is not None else default


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))


def get_telegram_message_config(db: Session) -> TelegramMessageConfig:
    raw = get_setting(db, "telegram_message_config", "").strip()
    if not raw:
        return TelegramMessageConfig()
    try:
        return TelegramMessageConfig.model_validate(json.loads(raw))
    except Exception:
        return TelegramMessageConfig()


def save_telegram_message_config(db: Session, cfg: TelegramMessageConfig) -> None:
    set_setting(
        db,
        "telegram_message_config",
        json.dumps(cfg.model_dump(), ensure_ascii=False),
    )


def format_tr_dt(dt: datetime | None) -> str:
    if not dt:
        return "-"
    local_dt = dt.astimezone(ISTANBUL_TZ)
    return local_dt.strftime("%d.%m.%Y %H:%M")


def format_tr_time(dt: datetime | None) -> str:
    if not dt:
        return "-"
    local_dt = dt.astimezone(ISTANBUL_TZ)
    return local_dt.strftime("%H:%M")


def build_pending_message_html(
    req: ReplenishmentRequest,
    cfg: TelegramMessageConfig,
) -> str:
    """
    AÇIK TALEP: Sohbet akışında tek bakışta dikkat çekmesi için parlak kırmızı
    '🔴 AÇIK TALEP — BEKLİYOR' durum başlığı ve ayırıcı çizgi ile gösterilir.
    """
    item = req.item
    sec = item.section
    sec_emoji = sec.emoji if sec else "⬜"
    sec_name = sec.name.upper() if sec else "GENEL / BÖLÜMSÜZ"

    title_num = f" <code>#{req.id}</code>" if cfg.show_title else ""
    lines: list[str] = [
        f"🔴 <b>AÇIK TALEP{title_num} — BEKLİYOR</b>",
        "━━━━━━━━━━━━━━━",
    ]

    if cfg.custom_prefix.strip():
        lines.append(f"📌 <b>{html.escape(cfg.custom_prefix.strip())}</b>")

    body_lines: list[str] = []
    if cfg.show_section:
        body_lines.append(f"{html.escape(sec_emoji)} <b>Bölüm:</b> {html.escape(sec_name)}")
    if cfg.show_reference:
        body_lines.append(f"📦 <b>Referans:</b> <code>{html.escape(item.reference_code)}</code>")
    if cfg.show_description:
        body_lines.append(f"📝 <b>Tanım:</b> {html.escape(item.description)}")
    if cfg.show_shelf and item.shelf_code:
        body_lines.append(f"📍 <b>Raf / Göz:</b> {html.escape(item.shelf_code)}")
    if cfg.show_unit and item.unit_info:
        body_lines.append(f"📐 <b>Birim / Paket:</b> {html.escape(item.unit_info)}")
    if cfg.show_time:
        body_lines.append(f"🕒 <b>Talep Saati:</b> {format_tr_dt(req.requested_at)}")

    if not body_lines:
        body_lines.append(f"📦 <b>Referans:</b> <code>{html.escape(item.reference_code)}</code>")

    lines.extend(body_lines)

    if req.scan_count > 1 and cfg.show_time:
        lines.append(f"🔔 <b>Tekrar Okutma:</b> {req.scan_count} kez")

    if cfg.show_footer_hint and cfg.show_complete_button:
        lines.extend(["", "<i>Ürün rafa bırakıldığında aşağıdaki butona basınız:</i>"])

    return "\n".join(lines).strip()


def build_completed_message_html(
    req: ReplenishmentRequest,
    cfg: TelegramMessageConfig,
) -> str:
    """
    KAPALI TALEP: Açık taleplerden tek bakışta ayrılması için Telegram'ın girintili
    <blockquote> kartı içinde '✅ KAPANDI — TESLİM EDİLDİ' başlığıyla ve butonsuz gösterilir.
    """
    item = req.item
    sec = item.section
    sec_emoji = sec.emoji if sec else "⬜"
    sec_name = sec.name.upper() if sec else "GENEL / BÖLÜMSÜZ"

    duration_str = ""
    if req.requested_at and req.completed_at:
        diff_min = max(1, round((req.completed_at - req.requested_at).total_seconds() / 60))
        duration_str = f" ({diff_min} dk)"

    title_num = f" <code>#{req.id}</code>" if cfg.show_title else ""
    inner: list[str] = [f"✅ <b>KAPANDI{title_num} — TESLİM EDİLDİ</b>"]

    if cfg.show_section:
        inner.append(f"{html.escape(sec_emoji)} <b>Bölüm:</b> {html.escape(sec_name)}")
    if cfg.show_reference or (not cfg.show_section and not cfg.show_description):
        inner.append(f"📦 <b>Referans:</b> <code>{html.escape(item.reference_code)}</code>")
    if cfg.show_description:
        inner.append(f"📝 <b>Tanım:</b> {html.escape(item.description)}")
    if cfg.show_shelf and item.shelf_code:
        inner.append(f"📍 <b>Raf / Göz:</b> {html.escape(item.shelf_code)}")

    meta_parts: list[str] = []
    if cfg.show_completed_by and req.completed_by:
        meta_parts.append(f"👤 {html.escape(req.completed_by)}")
    if req.completed_at:
        if cfg.show_time:
            meta_parts.append(
                f"⏱️ {format_tr_time(req.requested_at)} → {format_tr_time(req.completed_at)}{duration_str}"
            )
        else:
            meta_parts.append(f"🕒 {format_tr_time(req.completed_at)}{duration_str}")

    if meta_parts:
        inner.append(" • ".join(meta_parts))

    body_html = "\n".join(inner)
    return f"<blockquote>{body_html}</blockquote>"


async def send_telegram_request_notification(db: Session, req: ReplenishmentRequest) -> None:
    token = get_setting(db, "telegram_bot_token").strip()
    chat_id = get_setting(db, "telegram_chat_id").strip()

    if not token or not chat_id:
        req.telegram_sent = False
        req.telegram_error = "Telegram Bot Token veya Grup Chat ID henüz ayarlanmamış."
        db.commit()
        return

    cfg = get_telegram_message_config(db)
    text = build_pending_message_html(req, cfg)

    reply_markup = (
        {
            "inline_keyboard": [
                [
                    {
                        "text": "✅ Rafa Konuldu / Teslim Edildi",
                        "callback_data": sign_telegram_callback(req.id),
                    }
                ]
            ]
        }
        if cfg.show_complete_button
        else None
    )

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            payload: dict = {
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
            }
            if reply_markup:
                payload["reply_markup"] = reply_markup

            resp = await client.post(url, json=payload)
            data = resp.json()

            if resp.status_code == 200 and data.get("ok"):
                res_obj = data["result"]
                msg_id = res_obj["message_id"]
                actual_chat_id = str((res_obj.get("chat") or {}).get("id") or chat_id)
                req.telegram_chat_id = actual_chat_id
                req.telegram_message_id = int(msg_id)
                req.telegram_sent = True
                req.telegram_error = None
            else:
                req.telegram_sent = False
                req.telegram_error = data.get("description", f"HTTP {resp.status_code}")
    except Exception as exc:
        logger.exception("Failed sending Telegram notification for req #%s", req.id)
        req.telegram_sent = False
        req.telegram_error = str(exc)[:380]

    db.commit()


async def sync_telegram_completed_message(db: Session, req: ReplenishmentRequest) -> None:
    """Talep karşılandığında Telegram mesajını kapalı görünüme günceller ve butonu kaldırır."""
    token = get_setting(db, "telegram_bot_token").strip()
    if not token or not req.telegram_chat_id or not req.telegram_message_id:
        return

    cfg = get_telegram_message_config(db)
    text = build_completed_message_html(req, cfg)
    url = f"https://api.telegram.org/bot{token}/editMessageText"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                url,
                json={
                    "chat_id": req.telegram_chat_id,
                    "message_id": req.telegram_message_id,
                    "text": text,
                    "parse_mode": "HTML",
                    "reply_markup": {"inline_keyboard": []},
                },
            )
    except Exception as exc:
        logger.warning("Could not edit Telegram message for req #%s: %s", req.id, exc)


async def sync_telegram_cancelled_message(db: Session, req: ReplenishmentRequest) -> None:
    """Talep uygulama panelinden iptal edildiğinde Telegram mesajını kapalı/iptal görünümüne çevirir."""
    token = get_setting(db, "telegram_bot_token").strip()
    if not token or not req.telegram_chat_id or not req.telegram_message_id:
        return

    ref_escaped = html.escape(req.item.reference_code)
    text = (
        f"<blockquote>⚪ <b>KAPANDI — İPTAL EDİLDİ</b>\n"
        f"<s>📦 Referans: {ref_escaped}</s></blockquote>"
    )
    url = f"https://api.telegram.org/bot{token}/editMessageText"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                url,
                json={
                    "chat_id": req.telegram_chat_id,
                    "message_id": req.telegram_message_id,
                    "text": text,
                    "parse_mode": "HTML",
                    "reply_markup": {"inline_keyboard": []},
                },
            )
    except Exception as exc:
        logger.warning("Could not edit cancelled Telegram message for req #%s: %s", req.id, exc)


def _record_seen_chat(db: Session, chat_obj: dict) -> None:
    if not chat_obj or "id" not in chat_obj:
        return
    chat_id = str(chat_obj["id"])
    title = (
        chat_obj.get("title")
        or " ".join(filter(None, [chat_obj.get("first_name"), chat_obj.get("last_name")]))
        or chat_obj.get("username")
        or chat_id
    )
    chat_type = chat_obj.get("type", "unknown")

    raw = get_setting(db, "telegram_recent_chats", "[]")
    try:
        chats: list[dict] = json.loads(raw)
    except Exception:
        chats = []

    chats = [c for c in chats if str(c.get("id")) != chat_id]
    chats.insert(0, {"id": chat_id, "title": title, "type": chat_type})
    set_setting(db, "telegram_recent_chats", json.dumps(chats[:15], ensure_ascii=False))


async def _update_polling_status(status: str, detail: str = "") -> None:
    changed = False
    with SessionLocal() as db:
        prev = get_setting(db, "telegram_polling_status", "idle")
        prev_detail = get_setting(db, "telegram_polling_detail", "")
        if prev != status or prev_detail != detail:
            set_setting(db, "telegram_polling_status", status)
            set_setting(db, "telegram_polling_detail", detail)
            db.commit()
            changed = True
    if changed:
        await ws_manager.broadcast(
            "SETTINGS_UPDATED",
            {"action": "TELEGRAM_STATUS", "status": status},
        )


async def process_telegram_update(update: dict) -> None:
    with SessionLocal() as db:
        if "message" in update and isinstance(update["message"], dict):
            _record_seen_chat(db, update["message"].get("chat", {}))
            db.commit()
        elif "my_chat_member" in update and isinstance(update["my_chat_member"], dict):
            _record_seen_chat(db, update["my_chat_member"].get("chat", {}))
            db.commit()

        callback = update.get("callback_query")
        if not callback:
            return

        token = get_setting(db, "telegram_bot_token").strip()
        configured_chat_id = get_setting(db, "telegram_chat_id").strip()
        callback_id = callback.get("id")
        data = callback.get("data", "")
        msg_chat_id = str((callback.get("message") or {}).get("chat", {}).get("id", ""))

        req_id = parse_and_verify_telegram_callback(data)
        if req_id is None:
            logger.warning("Ignored invalid/unsigned callback_data: %s", data)
            return

        stmt = (
            select(ReplenishmentRequest)
            .options(joinedload(ReplenishmentRequest.item).joinedload(ComponentItem.section))
            .where(ReplenishmentRequest.id == req_id)
        )
        req = db.scalar(stmt)

        # Yalnızca talebin gönderildiği depo grubundan gelen tıklamaları kabul et
        allowed_chats = {c for c in (configured_chat_id, req.telegram_chat_id if req else None) if c}
        if allowed_chats and msg_chat_id and msg_chat_id not in allowed_chats:
            logger.warning("Rejected callback from unauthorized chat_id=%s", msg_chat_id)
            return

        from_user = callback.get("from", {}) or {}
        full_name = " ".join(
            filter(None, [from_user.get("first_name"), from_user.get("last_name")])
        ).strip()
        username = from_user.get("username")
        actor_label = full_name or (f"@{username}" if username else "Depo Görevlisi")

        async with httpx.AsyncClient(timeout=10.0) as client:
            if not req:
                if token and callback_id:
                    await client.post(
                        f"https://api.telegram.org/bot{token}/answerCallbackQuery",
                        json={"callback_query_id": callback_id, "text": "Talep bulunamadı."},
                    )
                return

            if req.status == "COMPLETED":
                if token and callback_id:
                    await client.post(
                        f"https://api.telegram.org/bot{token}/answerCallbackQuery",
                        json={
                            "callback_query_id": callback_id,
                            "text": f"Bu talep zaten {req.completed_by or 'depo'} tarafından kapatılmış.",
                        },
                    )
                await sync_telegram_completed_message(db, req)
                return

            req.status = "COMPLETED"
            req.completed_at = utc_now()
            req.completed_by = actor_label
            db.commit()
            db.refresh(req)
            logger.info("Request #%d completed via Telegram button by %s", req.id, actor_label)

            if token and callback_id:
                await client.post(
                    f"https://api.telegram.org/bot{token}/answerCallbackQuery",
                    json={
                        "callback_query_id": callback_id,
                        "text": f"✅ {req.item.reference_code} teslim edildi olarak kapatıldı!",
                    },
                )

        await sync_telegram_completed_message(db, req)
        await ws_manager.broadcast(
            "REQUEST_UPDATED",
            {
                "action": "COMPLETED",
                "request_id": req.id,
                "item_id": req.item_id,
                "reference_code": req.item.reference_code,
                "completed_by": req.completed_by,
            },
        )


async def telegram_polling_worker(stop_event: asyncio.Event) -> None:
    """Arka planda Telegram callback buton tıklamalarını dinler."""
    logger.info("Telegram callback polling worker started.")
    while not stop_event.is_set():
        try:
            with SessionLocal() as db:
                token = get_setting(db, "telegram_bot_token").strip()
                offset_str = get_setting(db, "telegram_last_update_id", "0")
                try:
                    offset = int(offset_str)
                except ValueError:
                    offset = 0

            if not token:
                await _update_polling_status("idle", "")
                await asyncio.sleep(3.0)
                continue

            url = f"https://api.telegram.org/bot{token}/getUpdates"
            params: dict = {
                "timeout": 15,
                "allowed_updates": json.dumps(
                    ["callback_query", "message", "my_chat_member"]
                ),
            }
            if offset > 0:
                params["offset"] = offset

            async with httpx.AsyncClient(timeout=25.0) as client:
                resp = await client.get(url, params=params)

            if resp.status_code == 200:
                payload = resp.json()
                if payload.get("ok"):
                    await _update_polling_status("ok", "Telegram içi buton dinleyicisi aktif.")
                    updates = payload.get("result", [])
                    max_next_offset = offset
                    for upd in updates:
                        upd_id = upd.get("update_id", 0)
                        if upd_id >= max_next_offset:
                            max_next_offset = upd_id + 1
                        await process_telegram_update(upd)

                    if max_next_offset > offset:
                        with SessionLocal() as db:
                            set_setting(db, "telegram_last_update_id", str(max_next_offset))
                            db.commit()
                else:
                    await _update_polling_status(
                        "error", payload.get("description", "Bilinmeyen Telegram hatası")
                    )
                    await asyncio.sleep(4.0)
            elif resp.status_code == 409:
                await _update_polling_status(
                    "conflict_409",
                    "Kayıtlı Bot Token (NotificationBot) aynı anda başka bir sunucudaki Paketleme "
                    "yazılımınızda da çalıştığı için Telegram tıklamaları diğer sunucuya gidiyor (HTTP 409). "
                    "@BotFather'dan sadece bu raf sistemine özel yeni bir bot açıp Token'ını girdiğiniz an buton çalışacaktır.",
                )
                await asyncio.sleep(6.0)
            elif resp.status_code == 401:
                await _update_polling_status("error", "Bot Token geçersiz (401 Unauthorized).")
                await asyncio.sleep(8.0)
            else:
                await asyncio.sleep(4.0)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.debug("Telegram polling iteration warning: %s", exc)
            await asyncio.sleep(4.0)

    logger.info("Telegram callback polling worker stopped.")
