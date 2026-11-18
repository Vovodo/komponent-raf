import re
import unicodedata
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ComponentItem, Section
from app.schemas import SectionCreate, SectionOut, SectionUpdate
from app.security import require_admin_auth
from app.services.ws_manager import ws_manager

router = APIRouter(
    prefix="/api/sections",
    tags=["sections"],
    dependencies=[Depends(require_admin_auth)],
)


def slugify_tr(text: str) -> str:
    tr_map = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    cleaned = text.translate(tr_map)
    cleaned = unicodedata.normalize("NFKD", cleaned).encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", cleaned.lower()).strip("_")
    return cleaned or "bolum"


@router.get("", response_model=list[SectionOut])
def list_sections(db: Session = Depends(get_db)):
    counts_subq = (
        select(ComponentItem.section_id, func.count(ComponentItem.id).label("cnt"))
        .group_by(ComponentItem.section_id)
        .subquery()
    )
    stmt = (
        select(Section, func.coalesce(counts_subq.c.cnt, 0).label("item_count"))
        .outerjoin(counts_subq, Section.id == counts_subq.c.section_id)
        .order_by(Section.sort_order.asc(), Section.id.asc())
    )
    rows = db.execute(stmt).all()
    result: list[SectionOut] = []
    for sec, cnt in rows:
        out = SectionOut.model_validate(sec)
        out.item_count = int(cnt or 0)
        result.append(out)
    return result


@router.post("", response_model=SectionOut)
def create_section(payload: SectionCreate, db: Session = Depends(get_db)):
    base_slug = slugify_tr(payload.slug or payload.name)
    slug = base_slug
    idx = 2
    while db.scalar(select(Section).where(Section.slug == slug)):
        slug = f"{base_slug}_{idx}"
        idx += 1

    sec = Section(
        slug=slug,
        name=payload.name.strip(),
        short_code=payload.short_code.strip().upper(),
        color_hex=payload.color_hex.upper(),
        emoji=payload.emoji.strip() or "🟦",
        sort_order=payload.sort_order,
    )
    db.add(sec)
    db.commit()
    db.refresh(sec)
    ws_manager.broadcast_from_thread("CATALOG_UPDATED", {"action": "SECTION_CREATED", "section_id": sec.id})
    out = SectionOut.model_validate(sec)
    out.item_count = 0
    return out


@router.patch("/{section_id}", response_model=SectionOut)
def update_section(section_id: int, payload: SectionUpdate, db: Session = Depends(get_db)):
    sec = db.get(Section, section_id)
    if not sec:
        raise HTTPException(status_code=404, detail="Bölüm bulunamadı.")

    if payload.name is not None:
        sec.name = payload.name.strip()
    if payload.short_code is not None:
        sec.short_code = payload.short_code.strip().upper()
    if payload.color_hex is not None:
        sec.color_hex = payload.color_hex.upper()
    if payload.emoji is not None:
        sec.emoji = payload.emoji.strip() or sec.emoji
    if payload.sort_order is not None:
        sec.sort_order = payload.sort_order

    db.commit()
    db.refresh(sec)
    ws_manager.broadcast_from_thread("CATALOG_UPDATED", {"action": "SECTION_UPDATED", "section_id": sec.id})
    cnt = db.scalar(select(func.count(ComponentItem.id)).where(ComponentItem.section_id == sec.id)) or 0
    out = SectionOut.model_validate(sec)
    out.item_count = int(cnt)
    return out


@router.delete("/{section_id}")
def delete_section(section_id: int, db: Session = Depends(get_db)):
    sec = db.get(Section, section_id)
    if not sec:
        raise HTTPException(status_code=404, detail="Bölüm bulunamadı.")
    cnt = db.scalar(select(func.count(ComponentItem.id)).where(ComponentItem.section_id == sec.id)) or 0
    if cnt > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Bu bölüme bağlı {cnt} adet referans var. Önce referansları başka bölüme taşıyın veya silin.",
        )
    db.delete(sec)
    db.commit()
    ws_manager.broadcast_from_thread("CATALOG_UPDATED", {"action": "SECTION_DELETED", "section_id": section_id})
    return {"ok": True}
