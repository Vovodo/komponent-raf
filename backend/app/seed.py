import logging
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppSetting, Section

logger = logging.getLogger("komponent_raf.seed")

DEFAULT_SECTIONS = [
    {
        "slug": "on_minder",
        "name": "Ön Minder",
        "short_code": "ÖN MİNDER",
        "color_hex": "#0057FF",
        "emoji": "🟦",
        "sort_order": 1,
    },
    {
        "slug": "on_sirt",
        "name": "Ön Sırt",
        "short_code": "ÖN SIRT",
        "color_hex": "#FF6B00",
        "emoji": "🟧",
        "sort_order": 2,
    },
    {
        "slug": "arka_minder",
        "name": "Arka Minder",
        "short_code": "ARKA MİNDER",
        "color_hex": "#009E49",
        "emoji": "🟩",
        "sort_order": 3,
    },
    {
        "slug": "arka_sirt",
        "name": "Arka Sırt",
        "short_code": "ARKA SIRT",
        "color_hex": "#E11D48",
        "emoji": "🟥",
        "sort_order": 4,
    },
    {
        "slug": "ortak",
        "name": "Ortak Raf",
        "short_code": "ORTAK",
        "color_hex": "#7C3AED",
        "emoji": "🟪",
        "sort_order": 5,
    },
]

DEFAULT_SETTINGS = {
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    "public_base_url": settings.DEFAULT_PUBLIC_BASE_URL,
    "company_name": "Dikişhane Komponent Rafı",
    "telegram_last_update_id": "0",
    "telegram_recent_chats": "[]",
}


def seed_defaults(db: Session) -> None:
    for sec_data in DEFAULT_SECTIONS:
        existing = db.scalar(select(Section).where(Section.slug == sec_data["slug"]))
        if not existing:
            db.add(Section(**sec_data))
            logger.info("Seeded default section: %s", sec_data["name"])

    for key, val in DEFAULT_SETTINGS.items():
        existing_setting = db.get(AppSetting, key)
        if not existing_setting:
            db.add(AppSetting(key=key, value=val))

    # Coolify canlı ortamına geçildiğinde DB'de localhost kalmışsa otomatik canlı domain'e yükselt
    eff_url = settings.effective_public_base_url
    pub_row = db.get(AppSetting, "public_base_url")
    if (
        pub_row
        and ("localhost" in pub_row.value or "127.0.0.1" in pub_row.value)
        and "localhost" not in eff_url
        and "127.0.0.1" not in eff_url
    ):
        pub_row.value = eff_url
        logger.info("Auto-upgraded public_base_url to live domain: %s", eff_url)

    db.commit()
