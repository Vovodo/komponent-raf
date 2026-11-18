import { QRCodeSVG } from 'qrcode.react';
import type { ComponentItem } from '../types';
import {
  getContrastText,
  getEffectiveSection,
  hexWithAlpha,
} from '../utils/color';

export type LabelColorStyle = 'band' | 'full';
export type LabelFontScale = 'normal' | 'large' | 'xlarge';
export type LabelLogoPlacement =
  | 'header_badge'
  | 'footer_brand'
  | 'qr_center'
  | 'hidden';

interface ShelfLabelCardProps {
  item: ComponentItem;
  baseUrl: string;
  logoUrl?: string | null;
  logoScale?: number; // %40 .. %260, varsayılan 100
  logoPlacement?: LabelLogoPlacement;
  widthMm: number;
  heightMm: number;
  colorStyle?: LabelColorStyle;
  fontScale?: LabelFontScale;
  showCutGuides?: boolean;
}

export function ShelfLabelCard({
  item,
  baseUrl,
  logoUrl,
  logoScale = 100,
  logoPlacement = 'header_badge',
  widthMm,
  heightMm,
  colorStyle = 'band',
  fontScale = 'normal',
  showCutGuides = true,
}: ShelfLabelCardProps) {
  const cleanBase = (baseUrl || window.location.origin).replace(/\/+$/, '');
  const scanUrl = `${cleanBase}/t/${item.qr_token}`;
  const effSection = getEffectiveSection(item.section);
  const secColor = effSection.color_hex || '#0057FF';
  const contrastOnColor = getContrastText(secColor);

  const hasLogo = Boolean(logoUrl) && logoPlacement !== 'hidden';
  const isTiny = heightMm < 36 || widthMm < 58;
  const isCompact = heightMm <= 48 || widthMm <= 74;

  // Kullanıcının seçtiği logo boyut çarpanı (%40 - %260)
  const logoFactor = Math.max(0.4, Math.min(2.6, (logoScale || 100) / 100));

  // Üst şeritteki şeffaf logonun yüksekliği ve maksimum genişliği (arka plan kutusu YOK, doğrudan şeffaf!)
  const baseHeaderLogoHeightMm = Math.max(
    3.6,
    Math.min(heightMm * 0.135, 9.2)
  );
  const logoHeaderHeightMm = +Math.min(
    heightMm * 0.28,
    baseHeaderLogoHeightMm * logoFactor
  ).toFixed(2);
  const logoHeaderMaxWidthMm = +Math.min(
    widthMm * 0.5,
    Math.max(12, widthMm * 0.25 * logoFactor)
  ).toFixed(2);

  // Üst başlık yüksekliği, logo büyütüldüğünde sıkışmaması için esnek uyum sağlar
  const baseHeaderBarMm = Math.max(5.2, Math.min(heightMm * 0.2, 11.5));
  const headerBarHeightMm =
    hasLogo && (logoPlacement === 'header_badge' || logoPlacement === 'qr_center')
      ? Math.max(baseHeaderBarMm, logoHeaderHeightMm + (isTiny ? 1.4 : 2.2))
      : baseHeaderBarMm;

  const bodyAvailHeightMm = Math.max(15, heightMm - headerBarHeightMm - 3.0);

  // QR kod boyutu
  const qrSizeMm = Math.max(
    14.5,
    Math.min(bodyAvailHeightMm * (isTiny ? 0.82 : 0.74), widthMm * 0.34, 46)
  );
  const qrSizePx = Math.round(qrSizeMm * 3.78);

  const scaleMultiplier =
    fontScale === 'xlarge' ? 1.22 : fontScale === 'large' ? 1.11 : 1.0;

  const baseRefMm = Math.max(
    3.4,
    Math.min(heightMm * 0.108, widthMm * 0.068, 9.8)
  );
  const refFontMm = +(baseRefMm * scaleMultiplier).toFixed(2);
  const descFontMm = +Math.max(
    2.25,
    Math.min(heightMm * 0.056, widthMm * 0.036, 4.4) *
      (fontScale === 'xlarge' ? 1.06 : 1.0)
  ).toFixed(2);
  const headerFontMm = +Math.max(
    2.3,
    Math.min(baseHeaderBarMm * 0.44, widthMm * 0.038, 4.3)
  ).toFixed(2);

  // Koyu zeminlerde koyu harfli şeffaf logonun harf konturunu belirginleştirir (dikdörtgen kutu oluşturmaz!)
  const headerLogoFilter =
    contrastOnColor === '#FFFFFF'
      ? 'drop-shadow(0 0 0.75px rgba(255,255,255,0.85))'
      : undefined;

  const qrLogoPx = Math.round(
    qrSizePx * Math.min(0.3, Math.max(0.14, 0.21 * logoFactor))
  );
  const qrCenterImage =
    hasLogo && logoPlacement === 'qr_center' && logoUrl
      ? {
          src: logoUrl,
          height: qrLogoPx,
          width: qrLogoPx,
          excavate: true,
        }
      : undefined;

  const footerLogoHeightMm = +Math.min(
    bodyAvailHeightMm * 0.32,
    Math.max(3.4, heightMm * 0.095) * logoFactor
  ).toFixed(2);
  const footerLogoMaxWidthMm = +Math.min(
    widthMm * 0.42,
    22 * logoFactor
  ).toFixed(2);

  if (colorStyle === 'full') {
    return (
      <div
        style={{
          width: `${widthMm}mm`,
          height: `${heightMm}mm`,
          backgroundColor: secColor,
          color: contrastOnColor,
          border: showCutGuides ? '0.3mm dashed rgba(15,23,42,0.45)' : 'none',
          padding: isTiny ? '1.5mm 2mm' : '2.2mm 2.6mm',
        }}
        className="relative box-border flex flex-col justify-between overflow-hidden rounded-[1.5mm] select-none"
      >
        {/* Üst Bölüm + Arka Plansız Şeffaf Logo */}
        <div
          style={{ minHeight: `${headerBarHeightMm * 0.82}mm` }}
          className="flex shrink-0 items-center justify-between gap-[1.5mm] border-b border-current/25 pb-[1mm]"
        >
          <div className="flex min-w-0 items-center gap-[1.5mm]">
            <span
              style={{ fontSize: `${headerFontMm}mm`, lineHeight: 1.05 }}
              className="truncate font-black tracking-wider uppercase"
            >
              {effSection.name}
            </span>
            {item.shelf_code && (
              <span
                style={{
                  fontSize: `${Math.max(2.1, headerFontMm * 0.8)}mm`,
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  color: contrastOnColor,
                }}
                className="shrink-0 rounded-[0.8mm] px-[1.3mm] py-[0.25mm] font-extrabold tracking-tight"
              >
                {item.shelf_code}
              </span>
            )}
          </div>

          {hasLogo &&
            logoUrl &&
            (logoPlacement === 'header_badge' ||
              logoPlacement === 'qr_center') && (
              <img
                src={logoUrl}
                alt="Logo"
                style={{
                  height: `${logoHeaderHeightMm}mm`,
                  maxWidth: `${logoHeaderMaxWidthMm}mm`,
                  filter: headerLogoFilter,
                }}
                className="shrink-0 object-contain"
              />
            )}
        </div>

        {/* Gövde + QR */}
        <div className="flex min-h-0 flex-1 items-center justify-between gap-[2mm] pt-[1mm]">
          <div className="flex h-full min-w-0 flex-1 flex-col justify-between pr-0.5">
            <div className="my-auto min-w-0">
              <div
                style={{ fontSize: `${refFontMm}mm`, lineHeight: 1.04 }}
                className="font-black tracking-tight break-words"
              >
                {item.reference_code}
              </div>
              <div
                style={{ fontSize: `${descFontMm}mm`, lineHeight: 1.2 }}
                className={`mt-[0.9mm] font-bold opacity-95 ${
                  isCompact ? 'line-clamp-2' : 'line-clamp-3'
                }`}
              >
                {item.description}
              </div>
            </div>

            {!isTiny &&
              (item.unit_info ||
                (hasLogo && logoPlacement === 'footer_brand')) && (
                <div className="mt-[0.7mm] flex items-center justify-between gap-1.5 pt-[0.5mm]">
                  {hasLogo && logoUrl && logoPlacement === 'footer_brand' && (
                    <img
                      src={logoUrl}
                      alt="Logo"
                      style={{
                        height: `${footerLogoHeightMm}mm`,
                        maxWidth: `${footerLogoMaxWidthMm}mm`,
                        filter: headerLogoFilter,
                      }}
                      className="shrink-0 object-contain"
                    />
                  )}
                  {item.unit_info && (
                    <span
                      style={{
                        fontSize: `${Math.max(2.1, descFontMm * 0.8)}mm`,
                      }}
                      className="truncate font-semibold opacity-90"
                    >
                      {item.unit_info}
                    </span>
                  )}
                </div>
              )}
          </div>

          <div className="flex shrink-0 flex-col items-center justify-center rounded-[1.4mm] bg-white p-[1.3mm] shadow-2xs">
            <QRCodeSVG
              value={scanUrl}
              size={qrSizePx}
              level={qrCenterImage ? 'H' : 'M'}
              marginSize={0}
              bgColor="#FFFFFF"
              fgColor="#000000"
              imageSettings={qrCenterImage}
              style={{ width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm` }}
            />
            {!isTiny && (
              <span
                style={{ fontSize: '1.95mm', color: '#0F172A' }}
                className="mt-[0.5mm] font-black tracking-wider uppercase"
              >
                TALEP QR
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Varsayılan 'band' stili: Üst şeritte ARKA PLANSIZ doğrudan şeffaf logo!
  return (
    <div
      style={{
        width: `${widthMm}mm`,
        height: `${heightMm}mm`,
        borderColor: secColor,
        borderWidth: isTiny ? '0.65mm' : isCompact ? '0.8mm' : '1mm',
        borderStyle: 'solid',
        outline: showCutGuides ? '0.25mm dashed #94A3B8' : 'none',
        outlineOffset: '0.45mm',
      }}
      className="relative box-border flex flex-col overflow-hidden rounded-[1.4mm] bg-white text-slate-950 select-none"
    >
      {/* Kalın Renkli Bölüm Başlık Bandı + Doğrudan Şeffaf Şirket Logosu */}
      <div
        style={{
          backgroundColor: secColor,
          color: contrastOnColor,
          minHeight: `${headerBarHeightMm}mm`,
          padding: isTiny ? '0.8mm 1.8mm' : '1mm 2.4mm',
        }}
        className="flex shrink-0 items-center justify-between gap-[1.5mm]"
      >
        <div className="flex min-w-0 items-center gap-[1.4mm]">
          <span
            style={{
              width: isTiny ? '1.8mm' : '2.4mm',
              height: isTiny ? '1.8mm' : '2.4mm',
              backgroundColor: contrastOnColor,
            }}
            className="inline-block shrink-0 rounded-full"
          />
          <span
            style={{ fontSize: `${headerFontMm}mm`, lineHeight: 1.05 }}
            className="truncate font-black tracking-wider uppercase"
          >
            {effSection.name}
          </span>
          {item.shelf_code && hasLogo && logoPlacement !== 'footer_brand' && (
            <span
              style={{
                fontSize: `${Math.max(2.05, headerFontMm * 0.78)}mm`,
                backgroundColor:
                  contrastOnColor === '#FFFFFF'
                    ? 'rgba(255,255,255,0.22)'
                    : 'rgba(15,23,42,0.12)',
                color: contrastOnColor,
              }}
              className="shrink-0 rounded-[0.7mm] px-[1.2mm] py-[0.2mm] font-extrabold tracking-tight"
            >
              {item.shelf_code}
            </span>
          )}
        </div>

        {/* Sağ Üst Alan: Şirket Logosu beyaz kutu OLMADAN sadece kendi harf/amblem pikselleriyle görünür */}
        <div className="flex shrink-0 items-center gap-[1.2mm]">
          {(!hasLogo || logoPlacement === 'footer_brand') && item.shelf_code && (
            <span
              style={{
                fontSize: `${Math.max(2.1, headerFontMm * 0.82)}mm`,
                backgroundColor: '#FFFFFF',
                color: '#0F172A',
              }}
              className="shrink-0 rounded-[0.8mm] px-[1.4mm] py-[0.25mm] font-black tracking-tight"
            >
              {item.shelf_code}
            </span>
          )}

          {hasLogo &&
            logoUrl &&
            (logoPlacement === 'header_badge' ||
              logoPlacement === 'qr_center') && (
              <img
                src={logoUrl}
                alt="Logo"
                style={{
                  height: `${logoHeaderHeightMm}mm`,
                  maxWidth: `${logoHeaderMaxWidthMm}mm`,
                  filter: headerLogoFilter,
                }}
                className="shrink-0 object-contain"
              />
            )}
        </div>
      </div>

      {/* Alt Gövde: Sol Renk Vurgusu + Referans & Tanım + Sağ QR */}
      <div className="flex min-h-0 flex-1 items-stretch">
        <div
          style={{
            width: isTiny ? '1.8mm' : isCompact ? '2.3mm' : '3mm',
            backgroundColor: secColor,
          }}
          className="shrink-0"
        />

        <div
          style={{
            padding: isTiny
              ? '1mm 1.5mm'
              : isCompact
                ? '1.3mm 2mm'
                : '1.8mm 2.5mm',
            backgroundColor: hexWithAlpha(secColor, '07'),
          }}
          className="flex min-w-0 flex-1 items-center justify-between gap-[1.8mm]"
        >
          {/* Sol Metin Bloğu */}
          <div className="flex h-full min-w-0 flex-1 flex-col justify-between">
            <div className="my-auto min-w-0">
              {!isTiny && (
                <div
                  style={{ fontSize: '1.95mm', color: secColor }}
                  className="font-extrabold tracking-widest uppercase"
                >
                  REFERANS
                </div>
              )}
              <div
                style={{ fontSize: `${refFontMm}mm`, lineHeight: 1.03 }}
                className="font-black tracking-tight text-slate-950 break-words"
              >
                {item.reference_code}
              </div>
              <div
                style={{ fontSize: `${descFontMm}mm`, lineHeight: 1.18 }}
                className={`mt-[0.8mm] font-bold text-slate-800 ${
                  isCompact ? 'line-clamp-2' : 'line-clamp-3'
                }`}
              >
                {item.description}
              </div>
            </div>

            {!isTiny && (
              <div className="mt-[0.8mm] flex items-center justify-between gap-1.5 border-t border-slate-200/90 pt-[0.7mm]">
                {hasLogo && logoUrl && logoPlacement === 'footer_brand' ? (
                  <div className="flex min-w-0 items-center gap-[1.5mm]">
                    <img
                      src={logoUrl}
                      alt="Logo"
                      style={{
                        height: `${footerLogoHeightMm}mm`,
                        maxWidth: `${footerLogoMaxWidthMm}mm`,
                      }}
                      className="shrink-0 object-contain"
                    />
                    {item.unit_info && (
                      <span
                        style={{ fontSize: '2.05mm' }}
                        className="truncate font-semibold text-slate-600"
                      >
                        • {item.unit_info}
                      </span>
                    )}
                  </div>
                ) : (
                  <span
                    style={{ fontSize: '2.05mm' }}
                    className="truncate font-semibold text-slate-600"
                  >
                    {item.unit_info || 'Bittiğinde QR kodu okutunuz'}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Sağ QR Kod Kutusu */}
          <div
            style={{ borderColor: hexWithAlpha(secColor, '40') }}
            className="flex shrink-0 flex-col items-center justify-center rounded-[1.2mm] border bg-white p-[1.1mm]"
          >
            <QRCodeSVG
              value={scanUrl}
              size={qrSizePx}
              level={qrCenterImage ? 'H' : 'M'}
              marginSize={0}
              bgColor="#FFFFFF"
              fgColor="#000000"
              imageSettings={qrCenterImage}
              style={{ width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm` }}
            />
            {!isTiny && (
              <span
                style={{
                  fontSize: '1.9mm',
                  backgroundColor: secColor,
                  color: contrastOnColor,
                }}
                className="mt-[0.7mm] w-full rounded-[0.5mm] py-[0.25mm] text-center font-black tracking-wider uppercase"
              >
                OKUT → TALEP
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
