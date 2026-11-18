from datetime import datetime, time
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import ComponentItem, ReplenishmentRequest, utc_now
from app.schemas import (
    CompleteRequestPayload,
    DashboardStats,
    ReplenishmentRequestOut,
    ScanTriggerResponse,
)
from app.security import check_rate_limit, require_admin_auth
from app.services.telegram_service import (
    send_telegram_request_notification,
    sync_telegram_cancelled_message,
    sync_telegram_completed_message,
)
from app.services.ws_manager import ws_manager

router = APIRouter(prefix="/api", tags=["requests"])
ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")


def _to_request_out(req: ReplenishmentRequest) -> ReplenishmentRequestOut:
    dto = ReplenishmentRequestOut.model_validate(req)
    dto.item.has_pending_request = req.status == "PENDING"
    dto.item.pending_request_id = req.id if req.status == "PENDING" else None
    return dto


@router.post("/scan/{qr_token}", response_model=ScanTriggerResponse)
async def trigger_scan_request(
    qr_token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    # Otomatik tarama / kod tahmin denemelerine karşı IP hız sınırı
    check_rate_limit(request, "qr_scan", max_requests=30, window_seconds=60)

    clean_token = qr_token.strip().upper()
    if len(clean_token) < 6 or len(clean_token) > 32:
        raise HTTPException(
            status_code=404,
            detail="Bu QR koda ait tanımlı bir komponent etiketi bulunamadı.",
        )

    item = db.scalar(
        select(ComponentItem)
        .options(joinedload(ComponentItem.section))
        .where(
            func.upper(ComponentItem.qr_token) == clean_token,
            ComponentItem.is_active.is_(True),
        )
    )
    if not item:
        raise HTTPException(
            status_code=404,
            detail="Bu QR koda ait tanımlı bir komponent etiketi bulunamadı.",
        )

    existing_pending = db.scalar(
        select(ReplenishmentRequest)
        .options(joinedload(ReplenishmentRequest.item).joinedload(ComponentItem.section))
        .where(
            ReplenishmentRequest.item_id == item.id,
            ReplenishmentRequest.status == "PENDING",
        )
        .order_by(ReplenishmentRequest.requested_at.desc())
    )

    if existing_pending:
        existing_pending.scan_count += 1
        existing_pending.last_scanned_at = utc_now()
        db.commit()
        db.refresh(existing_pending)

        if not existing_pending.telegram_sent:
            await send_telegram_request_notification(db, existing_pending)
            db.refresh(existing_pending)

        await ws_manager.broadcast(
            "REQUEST_UPDATED",
            {
                "action": "RESCANNED",
                "request_id": existing_pending.id,
                "item_id": item.id,
                "reference_code": item.reference_code,
                "scan_count": existing_pending.scan_count,
            },
        )

        return ScanTriggerResponse(
            outcome="ALREADY_PENDING",
            message="Bu referans için depoya zaten açık bir talep iletilmiş durumda. Depo hazırlığında!",
            request=_to_request_out(existing_pending),
        )

    new_req = ReplenishmentRequest(
        item_id=item.id,
        status="PENDING",
        scan_count=1,
        requested_at=utc_now(),
        last_scanned_at=utc_now(),
    )
    db.add(new_req)
    db.commit()

    new_req = db.scalar(
        select(ReplenishmentRequest)
        .options(joinedload(ReplenishmentRequest.item).joinedload(ComponentItem.section))
        .where(ReplenishmentRequest.id == new_req.id)
    )
    await send_telegram_request_notification(db, new_req)
    db.refresh(new_req)

    await ws_manager.broadcast(
        "REQUEST_UPDATED",
        {
            "action": "CREATED",
            "request_id": new_req.id,
            "item_id": item.id,
            "reference_code": item.reference_code,
        },
    )

    return ScanTriggerResponse(
        outcome="CREATED",
        message="Komponent talebiniz anında depoya iletildi!",
        request=_to_request_out(new_req),
    )


# --- Aşağıdaki tüm talep yönetim endpoint'leri PIN doğrulamalı X-Admin-Token gerektirir ---


@router.get(
    "/requests",
    response_model=list[ReplenishmentRequestOut],
    dependencies=[Depends(require_admin_auth)],
)
def list_requests(
    status: str = Query(default="ALL"),
    section_id: int | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    stmt = (
        select(ReplenishmentRequest)
        .join(ComponentItem, ReplenishmentRequest.item_id == ComponentItem.id)
        .options(joinedload(ReplenishmentRequest.item).joinedload(ComponentItem.section))
    )
    if status != "ALL":
        stmt = stmt.where(ReplenishmentRequest.status == status)
    if section_id is not None:
        stmt = stmt.where(ComponentItem.section_id == section_id)

    stmt = stmt.order_by(
        (ReplenishmentRequest.status != "PENDING").asc(),
        ReplenishmentRequest.requested_at.desc(),
    ).limit(limit)

    rows = list(db.scalars(stmt).unique().all())
    return [_to_request_out(r) for r in rows]


@router.post(
    "/requests/complete-all",
    dependencies=[Depends(require_admin_auth)],
)
async def complete_all_pending_requests(
    payload: CompleteRequestPayload,
    db: Session = Depends(get_db),
):
    pending_rows = list(
        db.scalars(
            select(ReplenishmentRequest)
            .options(joinedload(ReplenishmentRequest.item).joinedload(ComponentItem.section))
            .where(ReplenishmentRequest.status == "PENDING")
        )
        .unique()
        .all()
    )
    if not pending_rows:
        return {"completed_count": 0}

    actor = payload.completed_by.strip() or "Uygulama Paneli"
    now = utc_now()
    for req in pending_rows:
        req.status = "COMPLETED"
        req.completed_at = now
        req.completed_by = actor

    db.commit()

    for req in pending_rows:
        db.refresh(req)
        await sync_telegram_completed_message(db, req)

    await ws_manager.broadcast(
        "REQUEST_UPDATED",
        {"action": "COMPLETED_ALL", "count": len(pending_rows)},
    )
    return {"completed_count": len(pending_rows)}


@router.post(
    "/requests/{req_id}/complete",
    response_model=ReplenishmentRequestOut,
    dependencies=[Depends(require_admin_auth)],
)
async def complete_request(
    req_id: int,
    payload: CompleteRequestPayload,
    db: Session = Depends(get_db),
):
    req = db.scalar(
        select(ReplenishmentRequest)
        .options(joinedload(ReplenishmentRequest.item).joinedload(ComponentItem.section))
        .where(ReplenishmentRequest.id == req_id)
    )
    if not req:
        raise HTTPException(status_code=404, detail="Talep bulunamadı.")

    if req.status != "COMPLETED":
        req.status = "COMPLETED"
        req.completed_at = utc_now()
        req.completed_by = payload.completed_by.strip() or "Depo Paneli"
        db.commit()
        db.refresh(req)
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

    return _to_request_out(req)


@router.post(
    "/requests/{req_id}/cancel",
    response_model=ReplenishmentRequestOut,
    dependencies=[Depends(require_admin_auth)],
)
async def cancel_request(
    req_id: int,
    db: Session = Depends(get_db),
):
    req = db.scalar(
        select(ReplenishmentRequest)
        .options(joinedload(ReplenishmentRequest.item).joinedload(ComponentItem.section))
        .where(ReplenishmentRequest.id == req_id)
    )
    if not req:
        raise HTTPException(status_code=404, detail="Talep bulunamadı.")

    if req.status == "PENDING":
        req.status = "CANCELLED"
        req.completed_at = utc_now()
        req.completed_by = "İptal Edildi"
        db.commit()
        db.refresh(req)
        await sync_telegram_cancelled_message(db, req)
        await ws_manager.broadcast(
            "REQUEST_UPDATED",
            {
                "action": "CANCELLED",
                "request_id": req.id,
                "item_id": req.item_id,
                "reference_code": req.item.reference_code,
            },
        )

    return _to_request_out(req)


@router.post(
    "/requests/{req_id}/retry-telegram",
    response_model=ReplenishmentRequestOut,
    dependencies=[Depends(require_admin_auth)],
)
async def retry_telegram_send(req_id: int, db: Session = Depends(get_db)):
    req = db.scalar(
        select(ReplenishmentRequest)
        .options(joinedload(ReplenishmentRequest.item).joinedload(ComponentItem.section))
        .where(ReplenishmentRequest.id == req_id)
    )
    if not req:
        raise HTTPException(status_code=404, detail="Talep bulunamadı.")
    await send_telegram_request_notification(db, req)
    db.refresh(req)
    await ws_manager.broadcast(
        "REQUEST_UPDATED", {"action": "TELEGRAM_RETRY", "request_id": req.id}
    )
    return _to_request_out(req)


@router.get(
    "/stats",
    response_model=DashboardStats,
    dependencies=[Depends(require_admin_auth)],
)
def get_dashboard_stats(db: Session = Depends(get_db)):
    total_items = db.scalar(select(func.count(ComponentItem.id))) or 0
    pending_requests = (
        db.scalar(
            select(func.count(ReplenishmentRequest.id)).where(
                ReplenishmentRequest.status == "PENDING"
            )
        )
        or 0
    )

    now_tr = datetime.now(ISTANBUL_TZ)
    start_of_day_tr = datetime.combine(now_tr.date(), time.min, tzinfo=ISTANBUL_TZ)

    completed_today_rows = list(
        db.scalars(
            select(ReplenishmentRequest).where(
                ReplenishmentRequest.status == "COMPLETED",
                ReplenishmentRequest.completed_at >= start_of_day_tr,
            )
        ).all()
    )
    completed_today = len(completed_today_rows)

    durations: list[float] = []
    for r in completed_today_rows:
        if r.completed_at and r.requested_at:
            mins = (r.completed_at - r.requested_at).total_seconds() / 60.0
            if mins >= 0:
                durations.append(mins)

    avg_mins = round(sum(durations) / len(durations), 1) if durations else None
    return DashboardStats(
        total_items=int(total_items),
        pending_requests=int(pending_requests),
        completed_today=completed_today,
        avg_completion_minutes=avg_mins,
    )
