import asyncio
from contextlib import asynccontextmanager
import logging
from pathlib import Path

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select

from app.database import (
    Base,
    SessionLocal,
    engine,
    ensure_database_exists,
    run_schema_migrations,
)
from app.models import ComponentItem
from app.routers import items, requests, sections, settings as settings_router
from app.security import get_app_secret, verify_admin_token_str
from app.seed import seed_defaults
from app.services.telegram_service import telegram_polling_worker
from app.services.ws_manager import ws_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("komponent_raf.main")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_database_exists()
    Base.metadata.create_all(bind=engine)
    run_schema_migrations()
    with SessionLocal() as db:
        seed_defaults(db)
    get_app_secret()

    ws_manager.set_loop(asyncio.get_running_loop())

    stop_event = asyncio.Event()
    polling_task = asyncio.create_task(telegram_polling_worker(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        polling_task.cancel()
        try:
            await polling_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Komponent Raf Etiket & Telegram Talep Sistemi",
    version="1.2.0",
    lifespan=lifespan,
    # Dışarıdan endpoint keşfini zorlaştırmak için üretimde Swagger şemasını kapatmak yerine
    # tüm yönetim rotaları X-Admin-Token doğrulaması altındadır.
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sections.router)
app.include_router(items.router)
app.include_router(requests.router)
app.include_router(settings_router.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "komponent_raf"}


@app.websocket("/api/ws")
async def realtime_websocket(
    websocket: WebSocket,
    token: str | None = Query(default=None),
    qr: str | None = Query(default=None),
):
    is_authorized = verify_admin_token_str(token)

    if not is_authorized and qr:
        clean_qr = qr.strip().upper()
        if 6 <= len(clean_qr) <= 32:
            with SessionLocal() as db:
                exists = db.scalar(
                    select(ComponentItem.id).where(
                        func.upper(ComponentItem.qr_token) == clean_qr
                    )
                )
                is_authorized = exists is not None

    if not is_authorized:
        await websocket.close(code=1008)
        return

    await ws_manager.connect(websocket)
    try:
        await websocket.send_json({"type": "CONNECTED", "payload": {"status": "live"}})
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_json({"type": "PONG"})
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)


STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.exists():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(STATIC_DIR / "index.html"))
