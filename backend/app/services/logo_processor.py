import base64
import io
import math
from statistics import median

from PIL import Image


def _auto_trim_transparent(rgba: Image.Image, pad: int = 2) -> Image.Image:
    """Şeffaf logonun etrafındaki gereksiz boşlukları kırparak logoyu tam boyuta oturtur."""
    alpha = rgba.getchannel("A")
    mask = alpha.point(lambda a: 255 if a > 8 else 0)
    bbox = mask.getbbox()
    if not bbox:
        return rgba

    w, h = rgba.size
    left = max(0, bbox[0] - pad)
    top = max(0, bbox[1] - pad)
    right = min(w, bbox[2] + pad)
    bottom = min(h, bbox[3] + pad)
    return rgba.crop((left, top, right, bottom))


def _sample_edge_and_inset_pixels(rgba: Image.Image) -> list[tuple[int, int, int, int]]:
    """
    Kenar ve %5 iç çerçeve piksellerini örnekler (yuvarlatılmış köşeli beyaz kutuları da yakalamak için
    en uç köşeleri atlar).
    """
    w, h = rgba.size
    px = rgba.load()
    samples: list[tuple[int, int, int, int]] = []
    if w < 4 or h < 4:
        return samples

    margin_x = max(1, w // 12)
    margin_y = max(1, h // 12)
    inset_x = min(w // 2 - 1, max(1, w // 22))
    inset_y = min(h // 2 - 1, max(1, h // 22))
    step_x = max(1, (w - 2 * margin_x) // 30)
    step_y = max(1, (h - 2 * margin_y) // 30)

    for x in range(margin_x, w - margin_x, step_x):
        samples.append(px[x, 0])
        samples.append(px[x, h - 1])
        samples.append(px[x, inset_y])
        samples.append(px[x, h - 1 - inset_y])

    for y in range(margin_y, h - margin_y, step_y):
        samples.append(px[0, y])
        samples.append(px[w - 1, y])
        samples.append(px[inset_x, y])
        samples.append(px[w - 1 - inset_x, y])

    return samples


def _needs_background_removal(rgba: Image.Image, orig_format: str) -> tuple[bool, tuple[int, int, int]]:
    """
    Görselin arka plan temizliğine ihtiyacı olup olmadığını ve baskın arka plan rengini belirler.
    - PNG dışındaki tüm formatlarda (JPEG, WebP, BMP vb.) her zaman temizler.
    - PNG olup şeffaf boşluk kırpıldıktan sonra bile kenarlarında/iç çerçevesinde tekdüze opak zemin
      (ör. beyaz kutu) barındıran görselleri de otomatik yakalar ve temizler!
    """
    samples = _sample_edge_and_inset_pixels(rgba)
    if not samples:
        return (orig_format != "PNG"), (255, 255, 255)

    opaque = [(r, g, b) for (r, g, b, a) in samples if a >= 210]
    opaque_ratio = len(opaque) / len(samples)

    if not opaque:
        # Kenarların tamamı şeffaf -> gerçek dekupe PNG
        return False, (255, 255, 255)

    med_r = int(median([c[0] for c in opaque]))
    med_g = int(median([c[1] for c in opaque]))
    med_b = int(median([c[2] for c in opaque]))
    bg_color = (med_r, med_g, med_b)

    if orig_format != "PNG":
        return True, bg_color

    # PNG ise: örneklenen kenar piksellerinin çoğunluğu (%55+) aynı arka plan rengine yakınsa
    # bu PNG'nin arkasında beyaz/renkli dikdörtgen kutu kalmış demektir -> otomatik temizle!
    close_to_bg = sum(
        1
        for (r, g, b) in opaque
        if abs(r - med_r) <= 22 and abs(g - med_g) <= 22 and abs(b - med_b) <= 22
    )
    uniform_bg_ratio = close_to_bg / len(samples)
    if opaque_ratio >= 0.60 and uniform_bg_ratio >= 0.50:
        return True, bg_color

    return False, bg_color


def remove_background_and_optimize(
    raw_bytes: bytes,
    force_remove_bg: str = "auto",  # "auto" | "always" | "never"
    tolerance: int = 32,
) -> tuple[str, dict]:
    img = Image.open(io.BytesIO(raw_bytes))
    orig_format = (img.format or "PNG").upper()

    max_dim = 900
    if img.width > max_dim or img.height > max_dim:
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

    # Önce varsa dıştaki boş şeffaf çerçeveyi sıfırla ki içteki olası beyaz kutu kenara gelsin
    rgba = _auto_trim_transparent(img.convert("RGBA"), pad=0)

    auto_should_clean, bg_color = _needs_background_removal(rgba, orig_format)
    already_transparent = not auto_should_clean

    if force_remove_bg == "always":
        should_clean_bg = True
    elif force_remove_bg == "never":
        should_clean_bg = False
    else:
        should_clean_bg = auto_should_clean

    bg_removed = False
    detected_bg_hex = None

    if should_clean_bg:
        bg_r, bg_g, bg_b = bg_color
        detected_bg_hex = f"#{bg_r:02X}{bg_g:02X}{bg_b:02X}"

        tol = max(8, min(95, int(tolerance)))
        low_dist = float(tol)
        high_dist = float(tol + max(32, int(tol * 1.15)))
        band = max(1.0, high_dist - low_dist)

        w, h = rgba.size
        px = rgba.load()

        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a == 0:
                    continue

                dr = r - bg_r
                dg = g - bg_g
                db = b - bg_b
                euclid = math.sqrt(dr * dr + dg * dg + db * db)
                max_ch = max(abs(dr), abs(dg), abs(db))
                dist = 0.65 * euclid + 0.35 * max_ch

                if dist <= low_dist:
                    px[x, y] = (0, 0, 0, 0)
                elif dist < high_dist:
                    alpha_ratio = (dist - low_dist) / band
                    new_a = int(round((a / 255.0) * alpha_ratio * 255.0))
                    if new_a <= 4:
                        px[x, y] = (0, 0, 0, 0)
                    else:
                        inv_bg = 1.0 - alpha_ratio
                        ur = int(round((r - inv_bg * bg_r) / alpha_ratio))
                        ug = int(round((g - inv_bg * bg_g) / alpha_ratio))
                        ub = int(round((b - inv_bg * bg_b) / alpha_ratio))
                        px[x, y] = (
                            max(0, min(255, ur)),
                            max(0, min(255, ug)),
                            max(0, min(255, ub)),
                            max(0, min(255, new_a)),
                        )
        bg_removed = True

    trimmed = _auto_trim_transparent(rgba, pad=2)

    out_buf = io.BytesIO()
    trimmed.save(out_buf, format="PNG", optimize=True)
    png_b64 = base64.b64encode(out_buf.getvalue()).decode("ascii")
    data_url = f"data:image/png;base64,{png_b64}"

    meta = {
        "original_format": orig_format,
        "already_transparent": already_transparent,
        "bg_removed": bg_removed,
        "detected_bg_hex": detected_bg_hex,
        "width": trimmed.width,
        "height": trimmed.height,
    }
    return data_url, meta
