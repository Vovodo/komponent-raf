import asyncio
from datetime import datetime, timezone
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger("komponent_raf.ws")


class RealtimeConnectionManager:
    def __init__(self) -> None:
        self.active_connections: set[WebSocket] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info("WebSocket client connected (total=%d)", len(self.active_connections))

    def disconnect(self, websocket: WebSocket) -> None:
        self.active_connections.discard(websocket)
        logger.info("WebSocket client disconnected (total=%d)", len(self.active_connections))

    async def broadcast(self, event_type: str, payload: dict[str, Any] | None = None) -> None:
        if not self.active_connections:
            return

        message = {
            "type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "payload": payload or {},
        }
        stale: list[WebSocket] = []
        for conn in list(self.active_connections):
            try:
                await conn.send_json(message)
            except Exception:
                stale.append(conn)

        for dead in stale:
            self.active_connections.discard(dead)

    def broadcast_from_thread(self, event_type: str, payload: dict[str, Any] | None = None) -> None:
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self.broadcast(event_type, payload), self._loop)


ws_manager = RealtimeConnectionManager()
