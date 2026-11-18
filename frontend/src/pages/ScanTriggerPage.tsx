import jsQR from 'jsqr';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Flashlight,
  Loader2,
  PartyPopper,
  QrCode,
  RefreshCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useRealtimeSocket } from '../hooks/useRealtimeSocket';
import type { RealtimeWsEvent, ScanTriggerResponse } from '../types';
import { getContrastText, getEffectiveSection } from '../utils/color';

interface ScannedHistoryEntry {
  key: string;
  token: string;
  outcome: 'CREATED' | 'ALREADY_PENDING';
  referenceCode: string;
  description: string;
  sectionName: string;
  sectionColor: string;
  requestId: number;
  fulfilledBy?: string;
  scannedAt: string;
}

// Tarayıcıda yerleşik BarcodeDetector (Android Chrome GPU hızlandırmalı) tip tanımı
interface NativeBarcodeDetector {
  detect(
    image: ImageBitmapSource
  ): Promise<Array<{ rawValue?: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats: string[] }): NativeBarcodeDetector;
    };
  }
}

/**
 * Okutulan QR metninden (örn: https://raf.firma.com/t/RHFCQ2GM veya doğrudan kod)
 * güvenli bir şekilde sistem QR anahtarını ayıklar.
 */
function extractQrToken(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  // URL içinde /t/<TOKEN> formatı varsa ayıkla
  const urlMatch = trimmed.match(/\/t\/([A-Za-z0-9_-]{6,32})(?:[/?#]|$)/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1].toUpperCase();
  }

  // Doğrudan düz token okutulduysa
  if (/^[A-Za-z0-9]{6,32}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return null;
}

/**
 * Harici ses dosyası gerektirmeden Web Audio API ile net "Bip" onay sesi üretir.
 */
function playScanBeep(kind: 'success' | 'duplicate' | 'error') {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (kind === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1180, now + 0.07);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    } else if (kind === 'duplicate') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(620, now);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.start(now);
      osc.stop(now + 0.16);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(260, now);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    }
    setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 300);
  } catch {
    // Ses izni yoksa sessiz devam et
  }
}

const SAME_TOKEN_COOLDOWN_MS = 4500;

export function ScanTriggerPage() {
  const { qrToken: initialRouteToken } = useParams<{ qrToken?: string }>();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackPhotoInputRef = useRef<HTMLInputElement>(null);

  const initialTriggeredRef = useRef(false);
  const inFlightTokensRef = useRef<Set<string>>(new Set());
  const recentScanTimestampsRef = useRef<Map<string, number>>(new Map());
  const soundEnabledRef = useRef(true);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [latestBanner, setLatestBanner] = useState<{
    kind: 'success' | 'duplicate' | 'error' | 'fulfilled';
    title: string;
    refCode?: string;
    subtitle: string;
    colorHex: string;
  } | null>(null);

  const [history, setHistory] = useState<ScannedHistoryEntry[]>([]);
  const [activeWsQrToken, setActiveWsQrToken] = useState<string | undefined>(
    initialRouteToken
  );

  // Kamera durumları
  const [cameraState, setCameraState] = useState<
    'starting' | 'active' | 'blocked'
  >('starting');
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [flashRing, setFlashRing] = useState<'none' | 'green' | 'amber' | 'red'>(
    'none'
  );

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const triggerFlash = (color: 'green' | 'amber' | 'red') => {
    setFlashRing(color);
    setTimeout(() => {
      setFlashRing('none');
    }, 650);
  };

  /**
   * İlk açılıştaki URL token'ını veya kameradan ardışık okutulan her yeni QR token'ı işler.
   */
  const processScannedToken = useCallback(async (rawToken: string) => {
    const cleanToken = rawToken.trim().toUpperCase();
    if (!cleanToken) return;

    const now = Date.now();
    const lastTime = recentScanTimestampsRef.current.get(cleanToken) || 0;
    if (now - lastTime < SAME_TOKEN_COOLDOWN_MS) {
      return;
    }
    if (inFlightTokensRef.current.has(cleanToken)) {
      return;
    }

    recentScanTimestampsRef.current.set(cleanToken, now);
    inFlightTokensRef.current.add(cleanToken);
    setSubmitting(true);
    setActiveWsQrToken(cleanToken);

    try {
      const res: ScanTriggerResponse = await api.triggerScan(cleanToken);
      const sec = getEffectiveSection(res.request.item.section);
      const isNew = res.outcome === 'CREATED';

      if (soundEnabledRef.current) {
        playScanBeep(isNew ? 'success' : 'duplicate');
      }
      if ('vibrate' in navigator) {
        navigator.vibrate(isNew ? [100, 40, 100] : [140]);
      }
      triggerFlash(isNew ? 'green' : 'amber');

      setLatestBanner({
        kind: isNew ? 'success' : 'duplicate',
        title: isNew ? 'TALEBİNİZ ALINDI!' : 'ZATEN DEPO SIRASINDA',
        refCode: res.request.item.reference_code,
        subtitle: `${sec.name} • ${res.request.item.description}`,
        colorHex: sec.color_hex,
      });

      const timeStr = new Date().toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
      });

      setHistory((prev) => {
        const filtered = prev.filter(
          (h) => h.requestId !== res.request.id
        );
        return [
          {
            key: `${res.request.id}-${now}`,
            token: cleanToken,
            outcome: res.outcome,
            referenceCode: res.request.item.reference_code,
            description: res.request.item.description,
            sectionName: sec.name,
            sectionColor: sec.color_hex,
            requestId: res.request.id,
            scannedAt: timeStr,
          },
          ...filtered,
        ].slice(0, 25);
      });
    } catch (err) {
      if (soundEnabledRef.current) {
        playScanBeep('error');
      }
      if ('vibrate' in navigator) {
        navigator.vibrate([220]);
      }
      triggerFlash('red');
      setLatestBanner({
        kind: 'error',
        title: 'ETİKET TANINMADI',
        refCode: cleanToken.slice(0, 12),
        subtitle: (err as Error).message || 'Geçersiz QR kod okutuldu.',
        colorHex: '#E11D48',
      });
    } finally {
      inFlightTokensRef.current.delete(cleanToken);
      setSubmitting(false);
    }
  }, []);

  // 1. Sayfa ilk açıldığında URL'deki QR token için talebi otomatik gönder
  useEffect(() => {
    if (!initialRouteToken || initialTriggeredRef.current) return;
    initialTriggeredRef.current = true;
    void processScannedToken(initialRouteToken);
  }, [initialRouteToken, processScannedToken]);

  // 2. Sayfa açılır açılmaz arka kamerayı otomatik başlat ve sürekli QR tara!
  const startCamera = useCallback(async () => {
    // Mevcut açık akış varsa temizle
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    setCameraState('starting');
    setCameraErrorMsg(null);
    setTorchSupported(false);
    setTorchOn(false);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('blocked');
      setCameraErrorMsg(
        !window.isSecureContext
          ? 'Yerel ağda şifresiz bağlantı (http://) kullanıldığı için telefon tarayıcısı canlı kamerayı güvenlik gereği kilitliyor. Uygulama Coolify (https://) adresine alındığında canlı kamera otomatik açılacaktır.'
          : 'Bu tarayıcı canlı kamera erişimini desteklemiyor.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      const videoEl = videoRef.current;
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play().catch(() => {});
      }

      // Fener (Torch) desteğini kontrol et
      const track = stream.getVideoTracks()[0];
      if (track && 'getCapabilities' in track) {
        const caps = track.getCapabilities() as MediaTrackCapabilities & {
          torch?: boolean;
        };
        if (caps && caps.torch) {
          setTorchSupported(true);
        }
      }

      setCameraState('active');
    } catch {
      setCameraState('blocked');
      setCameraErrorMsg(
        'Kamera izni verilmedi veya cihaz kamerası meşgul. İzin verip tekrar başlatabilirsiniz.'
      );
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [startCamera]);

  // 3. Sürekli Kare Tarama Döngüsü (Android Native BarcodeDetector + iOS/Tüm Cihazlar jsQR Fallback)
  useEffect(() => {
    if (cameraState !== 'active') return;

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    let nativeDetector: NativeBarcodeDetector | null = null;
    if (typeof window !== 'undefined' && window.BarcodeDetector) {
      try {
        nativeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        nativeDetector = null;
      }
    }

    const scanFrame = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
        let detectedRaw: string | null = null;

        // Önce varsa donanım hızlandırmalı BarcodeDetector dene
        if (nativeDetector) {
          try {
            const barcodes = await nativeDetector.detect(video);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              detectedRaw = barcodes[0].rawValue;
            }
          } catch {
            nativeDetector = null;
          }
        }

        // BarcodeDetector yoksa (örn: iPhone Safari) jsQR ile canvas üzerinden çöz
        if (!detectedRaw && canvas) {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (vw > 0 && vh > 0) {
            const scale = Math.min(1, 520 / Math.max(vw, vh));
            const cw = Math.round(vw * scale);
            const ch = Math.round(vh * scale);
            if (canvas.width !== cw) canvas.width = cw;
            if (canvas.height !== ch) canvas.height = ch;

            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, cw, ch);
              const imageData = ctx.getImageData(0, 0, cw, ch);
              const qr = jsQR(imageData.data, cw, ch, {
                inversionAttempts: 'dontInvert',
              });
              if (qr && qr.data) {
                detectedRaw = qr.data;
              }
            }
          }
        }

        if (detectedRaw) {
          const parsedToken = extractQrToken(detectedRaw);
          if (parsedToken) {
            void processScannedToken(parsedToken);
          }
        }
      }

      if (!cancelled) {
        timerId = setTimeout(scanFrame, 140);
      }
    };

    timerId = setTimeout(scanFrame, 200);
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [cameraState, processScannedToken]);

  // Fener (Torch) Aç/Kapat
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      // ignore unsupported constraint
    }
  };

  // Kamera izni engellendiyse tek tuşla fotoğraf karesinden QR okuma yedeği
  const handleFallbackPhotoCapture = async (
    file: File | undefined
  ) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imgData.data, canvas.width, canvas.height);
      if (code?.data) {
        const tok = extractQrToken(code.data);
        if (tok) {
          await processScannedToken(tok);
          return;
        }
      }
      setLatestBanner({
        kind: 'error',
        title: 'QR KOD BULUNAMADI',
        subtitle: 'Fotoğrafta net bir etiket QR kodu okunamadı, tekrar deneyin.',
        colorHex: '#E11D48',
      });
    } finally {
      if (fallbackPhotoInputRef.current) {
        fallbackPhotoInputRef.current.value = '';
      }
    }
  };

  // WebSocket ile depocu okutulan ürünlerden birini rafa koyduğunda anında ekranda bildir
  const handleWsEvent = useCallback((evt: RealtimeWsEvent) => {
    if (
      evt.type === 'REQUEST_UPDATED' &&
      evt.payload?.action === 'COMPLETED'
    ) {
      const completedReqId = evt.payload.request_id as number | undefined;
      const actor = (evt.payload.completed_by as string) || 'Depo';
      const refCode = (evt.payload.reference_code as string) || '';

      setHistory((prev) => {
        const exists = prev.some((h) => h.requestId === completedReqId);
        if (!exists) return prev;
        setLatestBanner({
          kind: 'fulfilled',
          title: 'ÜRÜN RAFA KONULDU!',
          refCode,
          subtitle: `${actor} tarafından teslim edildi.`,
          colorHex: '#009E49',
        });
        return prev.map((h) =>
          h.requestId === completedReqId ? { ...h, fulfilledBy: actor } : h
        );
      });
    }
  }, []);

  useRealtimeSocket(handleWsEvent, { qrToken: activeWsQrToken });

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-950 text-white select-none">
      {/* ÜST KOMPAKT TALEP BİLDİRİM BANDI (Ufak alan — Ekranın ~%14'ü) */}
      <div className="z-20 shrink-0 border-b border-slate-800 bg-slate-900 px-3.5 py-2.5 shadow-lg">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2.5">
          {latestBanner ? (
            <div
              style={{ borderLeftColor: latestBanner.colorHex }}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border-l-4 bg-slate-800/90 px-3 py-2"
            >
              <div className="shrink-0">
                {submitting ? (
                  <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
                ) : latestBanner.kind === 'success' ? (
                  <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                ) : latestBanner.kind === 'fulfilled' ? (
                  <PartyPopper className="h-6 w-6 text-emerald-400" />
                ) : latestBanner.kind === 'duplicate' ? (
                  <Clock className="h-6 w-6 text-amber-400" />
                ) : (
                  <AlertTriangle className="h-6 w-6 text-rose-400" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-black tracking-wide uppercase ${
                      latestBanner.kind === 'success' ||
                      latestBanner.kind === 'fulfilled'
                        ? 'text-emerald-400'
                        : latestBanner.kind === 'duplicate'
                          ? 'text-amber-300'
                          : 'text-rose-400'
                    }`}
                  >
                    {latestBanner.title}
                  </span>
                  {latestBanner.refCode && (
                    <span className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-xs font-black text-white">
                      {latestBanner.refCode}
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] font-medium text-slate-300">
                  {latestBanner.subtitle}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl bg-slate-800/80 px-3 py-2">
              {submitting ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-emerald-400" />
              ) : (
                <QrCode className="h-5 w-5 shrink-0 text-sky-400" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-black text-white">
                  {submitting
                    ? 'TALEP DEPOYA İLETİLİYOR...'
                    : 'SERİ QR TALEP EKRANI HAZIR'}
                </div>
                <div className="truncate text-[11px] text-slate-400">
                  Kamerayı raftaki QR etiketlere tutarak art arda okutabilirsiniz
                </div>
              </div>
            </div>
          )}

          {/* Okutulan Toplam Talep Sayacı + Ses Butonu */}
          <div className="flex shrink-0 items-center gap-1.5">
            {history.length > 0 && (
              <div className="flex flex-col items-center justify-center rounded-xl bg-emerald-500/15 px-2.5 py-1 text-emerald-300 ring-1 ring-emerald-500/30">
                <span className="text-sm leading-none font-black">
                  {history.length}
                </span>
                <span className="text-[9px] font-bold uppercase">Talep</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSoundEnabled((v) => !v)}
              title={soundEnabled ? 'Bip sesini kapat' : 'Bip sesini aç'}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300 active:scale-95"
            >
              {soundEnabled ? (
                <Volume2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <VolumeX className="h-4 w-4 text-slate-500" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ORTA ANA BÖLÜM: TAM EKRAN CANLI QR OKUTMA PENCERESİ (Ekranın Çoğu!) */}
      <div className="relative min-h-0 flex-1 bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover transition-opacity duration-200 ${
            cameraState === 'active' ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Canlı Kamera Hedef Vizörü Çerçevesi */}
        {cameraState === 'active' && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6">
            <div
              className={`relative h-64 w-64 max-w-[76vw] max-h-[48vh] rounded-3xl transition-all duration-200 sm:h-72 sm:w-72 ${
                flashRing === 'green'
                  ? 'scale-105 ring-8 ring-emerald-400 bg-emerald-400/15'
                  : flashRing === 'amber'
                    ? 'scale-105 ring-8 ring-amber-400 bg-amber-400/15'
                    : flashRing === 'red'
                      ? 'ring-8 ring-rose-500 bg-rose-500/15'
                      : 'ring-2 ring-white/35'
              }`}
            >
              {/* Köşe Kılavuzları */}
              <span className="absolute -top-1 -left-1 h-9 w-9 rounded-tl-3xl border-t-4 border-l-4 border-emerald-400" />
              <span className="absolute -top-1 -right-1 h-9 w-9 rounded-tr-3xl border-t-4 border-r-4 border-emerald-400" />
              <span className="absolute -bottom-1 -left-1 h-9 w-9 rounded-bl-3xl border-b-4 border-l-4 border-emerald-400" />
              <span className="absolute -right-1 -bottom-1 h-9 w-9 rounded-br-3xl border-r-4 border-b-4 border-emerald-400" />
            </div>

            <div className="mt-5 rounded-full bg-slate-950/80 px-4 py-1.5 text-center text-xs font-extrabold text-white backdrop-blur-xs ring-1 ring-white/15">
              Sıradaki talep için başka bir QR koda tutun
            </div>
          </div>
        )}

        {/* Sağ Üst Fener / Yenile Kontrolleri */}
        {cameraState === 'active' && torchSupported && (
          <button
            type="button"
            onClick={toggleTorch}
            className={`absolute top-4 right-4 z-20 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-extrabold shadow-lg backdrop-blur-xs transition ${
              torchOn
                ? 'bg-amber-400 text-slate-950'
                : 'bg-slate-900/80 text-white ring-1 ring-white/20'
            }`}
          >
            <Flashlight className="h-4 w-4" />
            Fener
          </button>
        )}

        {/* Kamera Başlatılıyor Durumu */}
        {cameraState === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 p-6 text-center">
            <Loader2 className="h-11 w-11 animate-spin text-emerald-400" />
            <p className="mt-3 text-sm font-extrabold text-white">
              QR Kamera Açılıyor...
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Tarayıcı kamera izni sorarsa &quot;İzin Ver&quot; seçeneğine
              dokunun.
            </p>
          </div>
        )}

        {/* Kamera İzni Kapalı veya HTTP Kısıtı Yedek Ekranı */}
        {cameraState === 'blocked' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 p-6 text-center">
            <input
              ref={fallbackPhotoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => handleFallbackPhotoCapture(e.target.files?.[0])}
              className="hidden"
            />
            <div className="max-w-sm rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
              <Camera className="mx-auto h-11 w-11 text-sky-400" />
              <h2 className="mt-3 text-base font-black text-white">
                Kamera Erişimi Bekleniyor
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                {cameraErrorMsg}
              </p>

              <div className="mt-5 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-black text-white shadow-md active:scale-95"
                >
                  <RefreshCw className="h-4 w-4" />
                  Canlı Kamerayı Tekrar Aç
                </button>

                <button
                  type="button"
                  onClick={() => fallbackPhotoInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3 text-xs font-extrabold text-slate-200 active:scale-95"
                >
                  <Camera className="h-4 w-4 text-sky-400" />
                  Kameradan Fotoğraf Çekerek QR Okut
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ALT İNCE GEÇMİŞ ŞERİDİ: Bu oturumda art arda okutulan talepler */}
      {history.length > 0 && (
        <div className="z-20 shrink-0 border-t border-slate-800 bg-slate-900/95 px-3 py-2">
          <div className="mx-auto flex max-w-lg items-center gap-2 overflow-x-auto pb-0.5">
            <span className="shrink-0 text-[10px] font-extrabold tracking-wider text-slate-400 uppercase">
              İletilenler:
            </span>
            {history.map((h) => (
              <span
                key={h.key}
                style={{
                  backgroundColor: h.fulfilledBy ? '#059669' : h.sectionColor,
                  color: h.fulfilledBy
                    ? '#FFFFFF'
                    : getContrastText(h.sectionColor),
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-black shadow-2xs"
              >
                {h.fulfilledBy ? '🎉' : h.outcome === 'CREATED' ? '✓' : '⏳'}{' '}
                {h.referenceCode}
                <span className="text-[9px] font-semibold opacity-80">
                  {h.scannedAt}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
