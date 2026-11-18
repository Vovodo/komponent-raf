import logging
import psycopg
from psycopg import sql
from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

logger = logging.getLogger("komponent_raf.db")


class Base(DeclarativeBase):
    pass


def ensure_database_exists() -> None:
    """Sunucuda uygulamaya özel veritabanı (komponent_raf) yoksa otomatik oluşturur."""
    if settings.DATABASE_URL:
        return

    db_name = settings.POSTGRES_DB
    try:
        with psycopg.connect(settings.maintenance_conninfo, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
                exists = cur.fetchone() is not None
                if not exists:
                    logger.info("Creating dedicated PostgreSQL database: %s", db_name)
                    cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db_name)))
                else:
                    logger.info("PostgreSQL database '%s' already exists.", db_name)
    except Exception as exc:
        logger.warning("Could not verify/create database '%s': %s", db_name, exc)


engine = create_engine(
    settings.sqlalchemy_database_uri,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_schema_migrations() -> None:
    """Mevcut tablolar için geriye dönük uyumlu şema güncellemelerini uygular."""
    try:
        with engine.begin() as conn:
            # Excel'den bölümsüz (sonradan manuel atanacak) stok kodu aktarımı için section_id NULL izni
            conn.execute(
                text(
                    "ALTER TABLE component_items ALTER COLUMN section_id DROP NOT NULL;"
                )
            )
    except Exception as exc:
        logger.debug("Schema migration note: %s", exc)
