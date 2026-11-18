import unicodedata
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import ComponentItem, ReplenishmentRequest, Section, generate_qr_token
from app.schemas import (
    BulkImportRequest,
    BulkImportResult,
    ComponentItemCreate,
    ComponentItemOut,
    ComponentItemUpdate,
)
from app.security import require_admin_auth
from app.services.ws_manager import ws_manager

router = APIRouter(
    prefix="/api/items",
    tags=["items"],
    dependencies=[Depends(require_admin_auth)],
)


def _normalize_tr(val: str) -> str:
    tr_map = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    s = val.translate(tr_map)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return " ".join(s.lower().split())


def _unique_qr_token(db: Session, reserved: set[str] | None = None) -> str:
    for _ in range(30):
        tok = generate_qr_token(16)
        if reserved and tok in reserved:
            continue
        if not db.scalar(select(ComponentItem.id).where(ComponentItem.qr_token == tok)):
            if reserved is not None:
                reserved.add(tok)
            return tok
    tok = generate_qr_token(20)
    if reserved is not None:
        reserved.add(tok)
    return tok


def _section_match_clause(sec_id: int | None):
    if sec_id is None:
        return ComponentItem.section_id.is_(None)
    return ComponentItem.section_id == sec_id


def _enrich_items(db: Session, items: list[ComponentItem]) -> list[ComponentItemOut]:
    if not items:
        return []
    item_ids = [it.id for it in items]
    pending_rows = db.execute(
        select(ReplenishmentRequest.item_id, ReplenishmentRequest.id).where(
            ReplenishmentRequest.item_id.in_(item_ids),
            ReplenishmentRequest.status == "PENDING",
        )
    ).all()
    pending_map = {row[0]: row[1] for row in pending_rows}

    out_list: list[ComponentItemOut] = []
    for it in items:
        dto = ComponentItemOut.model_validate(it)
        req_id = pending_map.get(it.id)
        dto.has_pending_request = req_id is not None
        dto.pending_request_id = req_id
        out_list.append(dto)
    return out_list


@router.get("", response_model=list[ComponentItemOut])
def list_items(
    section_id: int | None = Query(default=None),
    unassigned_only: bool = Query(default=False),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    stmt = (
        select(ComponentItem)
        .outerjoin(Section, ComponentItem.section_id == Section.id)
        .options(joinedload(ComponentItem.section))
    )
    if unassigned_only:
        stmt = stmt.where(ComponentItem.section_id.is_(None))
    elif section_id is not None:
        stmt = stmt.where(ComponentItem.section_id == section_id)

    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                ComponentItem.reference_code.ilike(q),
                ComponentItem.description.ilike(q),
                ComponentItem.shelf_code.ilike(q),
                Section.name.ilike(q),
            )
        )

    # Bölüm atanmamış (yeni aktarılan) stok kodları en üstte görünsün ki hızlıca bölüm seçilebilsin
    stmt = stmt.order_by(
        Section.sort_order.asc().nulls_first(),
        ComponentItem.reference_code.asc(),
    )
    items = list(db.scalars(stmt).unique().all())
    return _enrich_items(db, items)


@router.post("", response_model=list[ComponentItemOut])
def create_items(payload: ComponentItemCreate, db: Session = Depends(get_db)):
    ref_code = payload.reference_code.strip().upper()
    desc = payload.description.strip()
    shelf = payload.shelf_code.strip() if payload.shelf_code else None
    unit = payload.unit_info.strip() if payload.unit_info else None

    created_or_updated: list[ComponentItem] = []
    target_sec_ids: list[int | None] = (
        list(dict.fromkeys(payload.section_ids)) if payload.section_ids else [None]
    )

    for sec_id in target_sec_ids:
        if sec_id is not None:
            sec = db.get(Section, sec_id)
            if not sec:
                raise HTTPException(status_code=404, detail=f"Bölüm bulunamadı (ID={sec_id}).")

        existing = db.scalar(
            select(ComponentItem)
            .options(joinedload(ComponentItem.section))
            .where(
                ComponentItem.reference_code == ref_code,
                _section_match_clause(sec_id),
            )
        )
        if existing:
            existing.description = desc
            existing.shelf_code = shelf
            existing.unit_info = unit
            existing.is_active = True
            created_or_updated.append(existing)
        else:
            new_item = ComponentItem(
                reference_code=ref_code,
                description=desc,
                section_id=sec_id,
                shelf_code=shelf,
                unit_info=unit,
                qr_token=_unique_qr_token(db),
                is_active=True,
            )
            db.add(new_item)
            db.flush()
            db.refresh(new_item)
            created_or_updated.append(new_item)

    db.commit()
    ws_manager.broadcast_from_thread("CATALOG_UPDATED", {"action": "ITEM_CREATED"})
    refreshed = list(
        db.scalars(
            select(ComponentItem)
            .options(joinedload(ComponentItem.section))
            .where(ComponentItem.id.in_([i.id for i in created_or_updated]))
        )
        .unique()
        .all()
    )
    return _enrich_items(db, refreshed)


@router.patch("/{item_id}", response_model=ComponentItemOut)
def update_item(item_id: int, payload: ComponentItemUpdate, db: Session = Depends(get_db)):
    item = db.scalar(
        select(ComponentItem)
        .options(joinedload(ComponentItem.section))
        .where(ComponentItem.id == item_id)
    )
    if not item:
        raise HTTPException(status_code=404, detail="Referans kaydı bulunamadı.")

    new_ref = (
        payload.reference_code.strip().upper()
        if payload.reference_code is not None
        else item.reference_code
    )
    section_field_provided = "section_id" in payload.model_fields_set
    new_sec_id = payload.section_id if section_field_provided else item.section_id

    if new_sec_id is not None:
        sec = db.get(Section, new_sec_id)
        if not sec:
            raise HTTPException(status_code=404, detail="Seçilen bölüm bulunamadı.")

    if (new_ref != item.reference_code) or (new_sec_id != item.section_id):
        conflict = db.scalar(
            select(ComponentItem.id).where(
                ComponentItem.reference_code == new_ref,
                _section_match_clause(new_sec_id),
                ComponentItem.id != item.id,
            )
        )
        if conflict:
            raise HTTPException(
                status_code=400,
                detail=f"{new_ref} referansı seçilen bölümde zaten kayıtlı.",
            )

    if section_field_provided:
        item.section_id = new_sec_id

    item.reference_code = new_ref
    if payload.description is not None:
        item.description = payload.description.strip()
    if payload.shelf_code is not None:
        item.shelf_code = payload.shelf_code.strip() or None
    if payload.unit_info is not None:
        item.unit_info = payload.unit_info.strip() or None
    if payload.is_active is not None:
        item.is_active = payload.is_active

    db.commit()
    ws_manager.broadcast_from_thread(
        "CATALOG_UPDATED", {"action": "ITEM_UPDATED", "item_id": item.id}
    )
    refreshed = db.scalar(
        select(ComponentItem)
        .options(joinedload(ComponentItem.section))
        .where(ComponentItem.id == item.id)
    )
    return _enrich_items(db, [refreshed])[0]


class BulkAssignSectionPayload(BaseModel):
    ids: list[int]
    section_id: int | None = None


@router.post("/bulk-assign-section")
def bulk_assign_section(payload: BulkAssignSectionPayload, db: Session = Depends(get_db)):
    if not payload.ids:
        return {"updated": 0, "skipped": 0}

    if payload.section_id is not None:
        sec = db.get(Section, payload.section_id)
        if not sec:
            raise HTTPException(status_code=404, detail="Hedef bölüm bulunamadı.")

    items = list(
        db.scalars(select(ComponentItem).where(ComponentItem.id.in_(payload.ids))).all()
    )
    updated = 0
    skipped = 0
    for item in items:
        if item.section_id == payload.section_id:
            continue
        conflict = db.scalar(
            select(ComponentItem.id).where(
                ComponentItem.reference_code == item.reference_code,
                _section_match_clause(payload.section_id),
                ComponentItem.id != item.id,
            )
        )
        if conflict:
            skipped += 1
            continue
        item.section_id = payload.section_id
        updated += 1

    db.commit()
    ws_manager.broadcast_from_thread(
        "CATALOG_UPDATED", {"action": "ITEMS_BULK_SECTION_ASSIGNED"}
    )
    return {"updated": updated, "skipped": skipped}


@router.delete("/{item_id}")
def delete_item(item_id: int, db: Session = Depends(get_db)):
    item = db.get(ComponentItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Referans kaydı bulunamadı.")
    db.delete(item)
    db.commit()
    ws_manager.broadcast_from_thread(
        "CATALOG_UPDATED", {"action": "ITEM_DELETED", "item_id": item_id}
    )
    return {"ok": True}


class BulkDeletePayload(BaseModel):
    ids: list[int]


@router.post("/bulk-delete")
def bulk_delete_items(payload: BulkDeletePayload, db: Session = Depends(get_db)):
    if not payload.ids:
        return {"deleted": 0}
    items = list(db.scalars(select(ComponentItem).where(ComponentItem.id.in_(payload.ids))).all())
    for it in items:
        db.delete(it)
    db.commit()
    ws_manager.broadcast_from_thread("CATALOG_UPDATED", {"action": "ITEMS_BULK_DELETED"})
    return {"deleted": len(items)}


@router.post("/bulk-import", response_model=BulkImportResult)
def bulk_import_items(payload: BulkImportRequest, db: Session = Depends(get_db)):
    sections = list(db.scalars(select(Section)).all())
    sec_by_id = {s.id: s for s in sections}
    if payload.default_section_id is not None and payload.default_section_id not in sec_by_id:
        raise HTTPException(status_code=400, detail="Varsayılan bölüm geçersiz.")

    sec_lookup: dict[str, int] = {}
    for s in sections:
        sec_lookup[_normalize_tr(s.name)] = s.id
        sec_lookup[_normalize_tr(s.short_code)] = s.id
        sec_lookup[_normalize_tr(s.slug.replace("_", " "))] = s.id
        if s.slug == "ortak":
            sec_lookup["ortak"] = s.id
            sec_lookup["ortak raf"] = s.id

    created_count = 0
    updated_count = 0
    skipped_count = 0
    errors: list[str] = []

    # Aynı Excel içindeki mükerrer satırları da tek transaction içinde güvenle yönet
    reserved_tokens: set[str] = set()
    batch_cache: dict[tuple[str, int | None], ComponentItem] = {}

    for idx, row in enumerate(payload.rows, start=1):
        ref = row.reference_code.strip().upper()
        desc = row.description.strip()
        if not ref or not desc:
            skipped_count += 1
            continue

        target_sec_id: int | None = payload.default_section_id
        if row.section_name and row.section_name.strip():
            norm = _normalize_tr(row.section_name)
            matched = sec_lookup.get(norm)
            if not matched:
                for key_str, sid in sec_lookup.items():
                    if norm and (norm in key_str or key_str in norm):
                        matched = sid
                        break
            if matched:
                target_sec_id = matched
            else:
                errors.append(
                    f"Satır {idx} ({ref}): '{row.section_name}' bölümü tanınmadı."
                )

        cache_key = (ref, target_sec_id)
        existing = batch_cache.get(cache_key)
        if existing is None:
            existing = db.scalar(
                select(ComponentItem).where(
                    ComponentItem.reference_code == ref,
                    _section_match_clause(target_sec_id),
                )
            )
            # Eğer bölümsüz aktarılıyorsa ve aynı stok kodu zaten herhangi bir bölümde varsa,
            # isteğe bağlı olarak mevcut kaydın tanımını güncelleyebilir veya bölümsüz oluşturabiliriz.
            # Aynı stok kodunu mükerrer bölümsüz açmamak için kontrol:
            if existing is None and target_sec_id is None:
                existing_any_sec = db.scalar(
                    select(ComponentItem).where(ComponentItem.reference_code == ref)
                )
                if existing_any_sec is not None:
                    existing = existing_any_sec

        if existing is not None:
            existing.description = desc
            if row.shelf_code is not None and row.shelf_code.strip():
                existing.shelf_code = row.shelf_code.strip()
            if row.unit_info is not None and row.unit_info.strip():
                existing.unit_info = row.unit_info.strip()
            batch_cache[cache_key] = existing
            updated_count += 1
        else:
            new_it = ComponentItem(
                reference_code=ref,
                description=desc,
                section_id=target_sec_id,
                shelf_code=(
                    row.shelf_code.strip()
                    if row.shelf_code and row.shelf_code.strip()
                    else None
                ),
                unit_info=(
                    row.unit_info.strip()
                    if row.unit_info and row.unit_info.strip()
                    else None
                ),
                qr_token=_unique_qr_token(db, reserved_tokens),
                is_active=True,
            )
            db.add(new_it)
            batch_cache[cache_key] = new_it
            created_count += 1

    db.commit()
    ws_manager.broadcast_from_thread(
        "CATALOG_UPDATED", {"action": "ITEMS_BULK_IMPORTED"}
    )
    return BulkImportResult(
        created_count=created_count,
        updated_count=updated_count,
        skipped_count=skipped_count,
        errors=errors[:15],
    )


@router.post("/seed-demo", response_model=list[ComponentItemOut])
def seed_demo_items(db: Session = Depends(get_db)):
    sections = {s.slug: s for s in db.scalars(select(Section)).all()}
    samples = [
        ("KM-1042", "Ön Minder Yan Kanat Lamine Sünger (Sol/Sağ)", "on_minder", "ÖM-A01", "Bağ / 25 Adet"),
        ("KM-1088", "Ön Minder Ön Burun Fitili Siyah PVC", "on_minder", "ÖM-A04", "Rulo / 100m"),
        ("KS-2015", "Ön Sırt Airbag Zayıflatma Etiketi & Şeridi", "on_sirt", "ÖS-B02", "Kutu / 250 Adet"),
        ("KS-2049", "Ön Sırt Başlık Burcu Geçiş Keçesi", "on_sirt", "ÖS-B05", "Poşet / 100 Adet"),
        ("AM-3012", "Arka Minder Isofix Çerçeve Biyesi Antrasit", "arka_minder", "AM-C01", "Bağ / 50 Adet"),
        ("AS-4030", "Arka Sırt Kol Dayama Fermuarı 48cm Siyah", "arka_sirt", "AS-D03", "Kutu / 100 Adet"),
        ("ORT-9001", "Cırt Bant (Kanca + İlmek) 25mm Siyah", "ortak", "ORT-01", "Rulo / 25m"),
        ("ORT-9014", "Gergi Tel Kancası Plastik Klips (J-Profil)", "ortak", "ORT-03", "Koli / 500 Adet"),
    ]

    for ref, desc, slug, shelf, unit in samples:
        sec = sections.get(slug)
        if not sec:
            continue
        exists = db.scalar(
            select(ComponentItem).where(
                ComponentItem.reference_code == ref,
                ComponentItem.section_id == sec.id,
            )
        )
        if not exists:
            db.add(
                ComponentItem(
                    reference_code=ref,
                    description=desc,
                    section_id=sec.id,
                    shelf_code=shelf,
                    unit_info=unit,
                    qr_token=_unique_qr_token(db),
                    is_active=True,
                )
            )
    db.commit()
    return list_items(section_id=None, unassigned_only=False, search=None, db=db)
