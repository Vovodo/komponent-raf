from datetime import datetime, timezone
import secrets
import string

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def generate_qr_token(length: int = 16) -> str:
    """
    Tahmin edilemez yüksek entropili (32^16 = 1.2 septilyon olasılık) kriptografik QR anahtarı üretir.
    Mevcut üretilmiş etiketlerin kodları veritabanında sabit kalır, yeni etiketler 16 haneli üretilir.
    """
    alphabet = string.ascii_uppercase + string.digits
    clean_alphabet = "".join(ch for ch in alphabet if ch not in "0OI1")
    return "".join(secrets.choice(clean_alphabet) for _ in range(length))


class Section(Base):
    __tablename__ = "sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    slug: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    short_code: Mapped[str] = mapped_column(String(16), nullable=False)
    color_hex: Mapped[str] = mapped_column(String(16), nullable=False)
    emoji: Mapped[str] = mapped_column(String(16), default="🟦", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    items: Mapped[list["ComponentItem"]] = relationship(
        "ComponentItem", back_populates="section", cascade="all, delete-orphan"
    )


class ComponentItem(Base):
    __tablename__ = "component_items"
    __table_args__ = (
        UniqueConstraint("reference_code", "section_id", name="uq_reference_per_section"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    reference_code: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False)
    section_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("sections.id", ondelete="SET NULL"), index=True, nullable=True
    )
    shelf_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    unit_info: Mapped[str | None] = mapped_column(String(80), nullable=True)
    qr_token: Mapped[str] = mapped_column(
        String(24), unique=True, index=True, default=generate_qr_token, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    section: Mapped["Section | None"] = relationship("Section", back_populates="items")
    requests: Mapped[list["ReplenishmentRequest"]] = relationship(
        "ReplenishmentRequest", back_populates="item", cascade="all, delete-orphan"
    )


class ReplenishmentRequest(Base):
    __tablename__ = "replenishment_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("component_items.id", ondelete="CASCADE"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(String(24), default="PENDING", index=True, nullable=False)
    telegram_chat_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    telegram_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    telegram_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    telegram_error: Mapped[str | None] = mapped_column(String(400), nullable=True)
    scan_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    last_scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by: Mapped[str | None] = mapped_column(String(120), nullable=True)

    item: Mapped["ComponentItem"] = relationship("ComponentItem", back_populates="requests")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
