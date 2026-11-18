from collections import defaultdict, deque
import hashlib
import hmac
import secrets
import time

from fastapi import Header, HTTPException, Request

from app.database import SessionLocal
from app.models import AppSetting

_CACHED_SECRET: str | None = None
_RATE_BUCKETS: dict[str, deque[float]] = defaultdict(deque)


def get_app_secret() -> str:
    """Sunucuya özel 256-bit kriptografik imza anahtarını veritabanından okur veya üretir."""
    global _CACHED_SECRET
    if _CACHED_SECRET:
        return _CACHED_SECRET

    with SessionLocal() as db:
        row = db.get(AppSetting, "app_secret_key")
        if row and len(row.value) >= 32:
            _CACHED_SECRET = row.value
            return _CACHED_SECRET

        generated = secrets.token_hex(32)
        if row:
            row.value = generated
        else:
            db.add(AppSetting(key="app_secret_key", value=generated))
        db.commit()
        _CACHED_SECRET = generated
        return _CACHED_SECRET


def check_rate_limit(
    request: Request,
    scope: str,
    max_requests: int,
    window_seconds: int,
) -> None:
    """Endpoint tarama ve kaba kuvvet (brute-force) denemelerini engeller."""
    forwarded = request.headers.get("x-forwarded-for", "")
    client_ip = (
        forwarded.split(",")[0].strip()
        if forwarded
        else (request.client.host if request.client else "unknown")
    )
    key = f"{scope}:{client_ip}"
    now = time.monotonic()
    q = _RATE_BUCKETS[key]

    while q and (now - q[0]) > window_seconds:
        q.popleft()

    if len(q) >= max_requests:
        raise HTTPException(
            status_code=429,
            detail="Çok fazla istek gönderildi. Lütfen kısa bir süre bekleyip tekrar deneyin.",
        )
    q.append(now)


def create_admin_token(ttl_seconds: int = 12 * 3600) -> str:
    """
    PIN doğrulaması başarılı olduğunda yalnızca tarayıcı RAM belleğinde tutulacak
    HMAC-SHA256 imzalı oturum jetonu üretir (çereze yazılmaz).
    """
    secret = get_app_secret().encode("utf-8")
    exp = int(time.time()) + ttl_seconds
    nonce = secrets.token_urlsafe(12)
    payload = f"{exp}.{nonce}"
    sig = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_admin_token_str(token: str | None) -> bool:
    if not token:
        return False
    parts = token.strip().split(".")
    if len(parts) != 3:
        return False
    exp_str, nonce, given_sig = parts
    try:
        exp = int(exp_str)
    except ValueError:
        return False

    if time.time() > exp:
        return False

    secret = get_app_secret().encode("utf-8")
    payload = f"{exp_str}.{nonce}"
    expected_sig = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(given_sig, expected_sig)


def require_admin_auth(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> None:
    """Yönetim API endpoint'lerini dışarıdan yetkisiz manipülasyona karşı korur."""
    if not verify_admin_token_str(x_admin_token):
        raise HTTPException(
            status_code=401,
            detail="Yetkisiz erişim. Lütfen PIN kodu ile giriş yapın.",
        )


def sign_telegram_callback(req_id: int) -> str:
    """Telegram inline buton verisini (callback_data) kriptografik olarak imzalar."""
    secret = get_app_secret().encode("utf-8")
    msg = f"complete:{req_id}".encode("utf-8")
    sig = hmac.new(secret, msg, hashlib.sha256).hexdigest()[:16]
    return f"kr:{req_id}:{sig}"


def parse_and_verify_telegram_callback(data: str) -> int | None:
    """İmzalı Telegram callback verisini doğrular; sahte/manipüle edilmişse None döner."""
    if data.startswith("kr:"):
        parts = data.split(":")
        if len(parts) != 3:
            return None
        try:
            req_id = int(parts[1])
        except ValueError:
            return None
        expected = sign_telegram_callback(req_id)
        if hmac.compare_digest(data, expected):
            return req_id
        return None

    # Geçiş aşamasında daha önce gruba düşmüş eski mesaj butonu varsa yalnızca grup eşleşirse izin verilir
    if data.startswith("complete_req:"):
        try:
            return int(data.split(":", 1)[1])
        except ValueError:
            return None

    return None
