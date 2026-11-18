import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Filter,
  Globe,
  ImagePlus,
  Minus,
  Palette,
  Plus,
  Radio,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { ConfirmModal } from '../components/ConfirmModal';
import { ShelfLabelCard } from '../components/ShelfLabelCard';
import type {
  AppSettings,
  ComponentItem,
  RecentTelegramChat,
  Section,
  TelegramMessageConfig,
} from '../types';
import { getContrastText } from '../utils/color';

const INDUSTRIAL_PALETTE = [
  '#0057FF', // Kobalt Mavi (Ön Minder)
  '#FF6B00', // Endüstriyel Turuncu (Ön Sırt)
  '#009E49', // Canlı Yeşil (Arka Minder)
  '#E11D48', // Kırmızı / Mercan (Arka Sırt)
  '#7C3AED', // Canlı Mor (Ortak)
  '#EAB308', // Uyarı Sarısı
  '#0891B2', // Turkuaz
  '#DB2777', // Fuşya
  '#1E293B', // Koyu Antrasit
];

const DEFAULT_MSG_CONFIG: TelegramMessageConfig = {
  show_title: false,
  show_section: false,
  show_reference: true,
  show_description: false,
  show_shelf: false,
  show_unit: false,
  show_time: false,
  show_footer_hint: false,
  show_complete_button: true,
  show_completed_by: true,
  button_mode: 'auto',
  custom_prefix: '',
};

interface SettingsPageProps {
  sections: Section[];
  settings: AppSettings | null;
  onRefresh: () => Promise<void>;
}

export function SettingsPage({
  sections,
  settings,
  onRefresh,
}: SettingsPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scaleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Telegram & Genel Ayarlar
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState(settings?.telegram_chat_id || '');
  const [publicUrl, setPublicUrl] = useState(
    settings?.public_base_url || window.location.origin
  );
  const [companyName, setCompanyName] = useState(
    settings?.company_name || 'Dikişhane Komponent Rafı'
  );
  const [msgConfig, setMsgConfig] = useState<TelegramMessageConfig>(
    settings?.telegram_message_config || DEFAULT_MSG_CONFIG
  );
  const [recentChats, setRecentChats] = useState<RecentTelegramChat[]>(
    settings?.recent_chats || []
  );

  // Akıllı Logo & Boyut State
  const [logoScale, setLogoScale] = useState<number>(
    settings?.company_logo_scale ?? 100
  );
  const [bgTolerance, setBgTolerance] = useState<number>(
    settings?.company_logo_meta?.tolerance ?? 32
  );
  const [bgMode, setBgMode] = useState<'auto' | 'always' | 'never'>(
    (settings?.company_logo_meta?.mode as 'auto' | 'always' | 'never') || 'auto'
  );
  const [previewSecIdx, setPreviewSecIdx] = useState<number>(0);

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoFeedback, setLogoFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
  } | null>(null);

  const [savingSettings, setSavingSettings] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
  } | null>(null);

  // Yeni Bölüm Ekleme
  const [newSecName, setNewSecName] = useState('');
  const [newSecColor, setNewSecColor] = useState('#0891B2');
  const [confirmRemoveLogo, setConfirmRemoveLogo] = useState(false);
  const [pendingDeleteSec, setPendingDeleteSec] = useState<Section | null>(
    null
  );

  useEffect(() => {
    if (settings) {
      setChatId(settings.telegram_chat_id);
      setPublicUrl(settings.public_base_url);
      setCompanyName(settings.company_name);
      setRecentChats(settings.recent_chats || []);
      setLogoScale(settings.company_logo_scale ?? 100);
      if (settings.telegram_message_config) {
        setMsgConfig(settings.telegram_message_config);
      }
      if (settings.company_logo_meta?.tolerance) {
        setBgTolerance(settings.company_logo_meta.tolerance);
      }
      if (settings.company_logo_meta?.mode) {
        setBgMode(
          settings.company_logo_meta.mode as 'auto' | 'always' | 'never'
        );
      }
    }
  }, [settings]);

  const toggleMsgField = (field: keyof TelegramMessageConfig) => {
    setMsgConfig((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const applyMsgPreset = (preset: 'ref_only' | 'standard' | 'full') => {
    if (preset === 'ref_only') {
      setMsgConfig((prev) => ({
        ...prev,
        show_title: false,
        show_section: false,
        show_reference: true,
        show_description: false,
        show_shelf: false,
        show_unit: false,
        show_time: false,
        show_footer_hint: false,
        show_complete_button: true,
      }));
    } else if (preset === 'standard') {
      setMsgConfig((prev) => ({
        ...prev,
        show_title: false,
        show_section: true,
        show_reference: true,
        show_description: true,
        show_shelf: false,
        show_unit: false,
        show_time: false,
        show_footer_hint: false,
        show_complete_button: true,
      }));
    } else {
      setMsgConfig((prev) => ({
        ...prev,
        show_title: true,
        show_section: true,
        show_reference: true,
        show_description: true,
        show_shelf: true,
        show_unit: true,
        show_time: true,
        show_footer_hint: true,
        show_complete_button: true,
      }));
    }
  };

  const handleLogoScaleChange = (nextScale: number) => {
    const clamped = Math.max(40, Math.min(240, Math.round(nextScale)));
    setLogoScale(clamped);

    if (scaleDebounceRef.current) {
      clearTimeout(scaleDebounceRef.current);
    }
    scaleDebounceRef.current = setTimeout(() => {
      api
        .updateCompanyLogoScale(clamped)
        .then(() => onRefresh())
        .catch(() => {});
    }, 220);
  };

  const handleLogoFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setUploadingLogo(true);
    setLogoFeedback(null);
    try {
      const res = await api.uploadCompanyLogo(file, {
        remove_bg: 'auto',
        tolerance: bgTolerance,
      });
      await onRefresh();
      const meta = res.company_logo_meta;
      if (meta?.bg_removed) {
        setLogoFeedback({
          type: 'ok',
          msg: `Akıllı arka plan temizliği uygulandı (${meta.original_format} → Şeffaf PNG, silinen zemin: ${meta.detected_bg_hex || 'Beyaz'})!`,
        });
      } else {
        setLogoFeedback({
          type: 'ok',
          msg: 'Şeffaf logonuz optimize edildi ve kenar boşlukları otomatik kırpıldı!',
        });
      }
    } catch (err) {
      setLogoFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleReprocessLogo = async (
    nextMode: 'auto' | 'always' | 'never',
    nextTolerance: number
  ) => {
    setBgMode(nextMode);
    setBgTolerance(nextTolerance);
    if (!settings?.company_logo_data_url) return;
    setUploadingLogo(true);
    setLogoFeedback(null);
    try {
      const res = await api.reprocessCompanyLogo(nextMode, nextTolerance);
      await onRefresh();
      if (res.company_logo_meta?.bg_removed) {
        setLogoFeedback({
          type: 'ok',
          msg: `Logo arka planı hassasiyet=${nextTolerance} ile yeniden temizlendi.`,
        });
      } else {
        setLogoFeedback({
          type: 'ok',
          msg: 'Logo orijinal katmanlarıyla optimize edildi.',
        });
      }
    } catch (err) {
      setLogoFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = () => {
    setConfirmRemoveLogo(true);
  };

  const executeRemoveLogo = async () => {
    setUploadingLogo(true);
    setLogoFeedback(null);
    try {
      await api.removeCompanyLogo();
      setConfirmRemoveLogo(false);
      await onRefresh();
      setLogoFeedback({ type: 'ok', msg: 'Logo kaldırıldı.' });
    } catch (err) {
      setLogoFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSavingSettings(true);
    setFeedback(null);
    try {
      const updated = await api.saveSettings({
        telegram_bot_token: botToken,
        telegram_chat_id: chatId,
        public_base_url: publicUrl,
        company_name: companyName,
        telegram_message_config: msgConfig,
      });
      setBotToken('');
      setRecentChats(updated.recent_chats || []);
      await onRefresh();
      setFeedback({
        type: 'ok',
        msg: 'Telegram ve mesaj filtre ayarlarınız kalıcı olarak kaydedildi!',
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDiscoverChats = async () => {
    setDiscovering(true);
    setFeedback(null);
    try {
      if (botToken.trim()) {
        await api.saveSettings({
          telegram_bot_token: botToken.trim(),
          telegram_chat_id: chatId,
          public_base_url: publicUrl,
          company_name: companyName,
          telegram_message_config: msgConfig,
        });
        setBotToken('');
        await onRefresh();
      }
      const res = await api.discoverTelegramChats();
      setRecentChats(res.recent_chats);
      if (res.recent_chats.length > 0 && !chatId) {
        setChatId(res.recent_chats[0].id);
      }
      setFeedback({
        type: 'ok',
        msg:
          res.recent_chats.length > 0
            ? `Bot (@${res.bot_username}) doğrulandı ve ${res.recent_chats.length} sohbet/grup bulundu!`
            : `Bot (@${res.bot_username}) doğrulandı. Grubu görmek için botu Telegram grubuna ekleyip grupta bir mesaj yazın ve tekrar tıklayın.`,
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setDiscovering(false);
    }
  };

  const handleSendTestMessage = async () => {
    setTestingTelegram(true);
    setFeedback(null);
    try {
      await api.saveSettings({
        telegram_bot_token: botToken.trim(),
        telegram_chat_id: chatId,
        public_base_url: publicUrl,
        company_name: companyName,
        telegram_message_config: msgConfig,
      });
      setBotToken('');
      await onRefresh();
      const res = await api.sendTelegramTest();
      setFeedback({ type: 'ok', msg: res.message });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setTestingTelegram(false);
    }
  };

  const handleUpdateSectionColor = async (sec: Section, colorHex: string) => {
    await api.updateSection(sec.id, { color_hex: colorHex });
    await onRefresh();
  };

  const handleUpdateSectionName = async (sec: Section, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === sec.name) return;
    await api.updateSection(sec.id, {
      name: trimmed,
      short_code: trimmed.toLocaleUpperCase('tr-TR').slice(0, 16),
    });
    await onRefresh();
  };

  const handleCreateSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSecName.trim()) return;
    await api.createSection({
      name: newSecName.trim(),
      short_code: newSecName.trim().toLocaleUpperCase('tr-TR').slice(0, 16),
      color_hex: newSecColor,
      emoji: '🟦',
      sort_order: sections.length + 1,
    });
    setNewSecName('');
    await onRefresh();
  };

  const handleDeleteSection = (sec: Section) => {
    setPendingDeleteSec(sec);
  };

  const executeDeleteSection = async () => {
    if (!pendingDeleteSec) return;
    try {
      await api.deleteSection(pendingDeleteSec.id);
      setPendingDeleteSec(null);
      await onRefresh();
    } catch (err) {
      alert((err as Error).message);
      setPendingDeleteSec(null);
    }
  };

  const previewSection: Section =
    sections[previewSecIdx] ||
    sections[0] || {
      id: 1,
      slug: 'on_minder',
      name: 'Ön Minder',
      short_code: 'ÖN MİNDER',
      color_hex: '#0057FF',
      emoji: '🟦',
      sort_order: 1,
      item_count: 0,
    };

  const previewItem: ComponentItem = {
    id: 0,
    reference_code: 'KM-1042',
    description: 'Ön Minder Yan Kanat Lamine Sünger (Sol/Sağ)',
    section_id: previewSection.id,
    section: previewSection,
    shelf_code: 'ÖM-A01',
    unit_info: 'Bağ / 25 Adet',
    qr_token: 'ORNEKQR8',
    is_active: true,
    has_pending_request: false,
    pending_request_id: null,
    created_at: '',
    updated_at: '',
  };

  const logoMeta = settings?.company_logo_meta;
  const pollingStatus = settings?.telegram_polling_status || 'idle';

  // Canlı Telegram Balonu satırları
  const tgLinesCount = [
    msgConfig.show_title,
    msgConfig.show_section,
    msgConfig.show_reference,
    msgConfig.show_description,
    msgConfig.show_shelf,
    msgConfig.show_unit,
    msgConfig.show_time,
  ].filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* KART 1: Telegram Mesaj İçeriği Filtresi & Canlı Önizleme */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <Filter className="h-5 w-5 text-sky-600" />
            <div>
              <h2 className="text-base font-black text-slate-900">
                QR Okutulduğunda Telegram&apos;a Düşecek Bilgileri Filtrele
              </h2>
              <p className="text-xs text-slate-500">
                Telegram mesajında hangi satırların görüneceğini seçip kaydedin.
                (Örn: Sadece Referans Kodu)
              </p>
            </div>
          </div>

          {/* Hızlı Şablon Butonları */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => applyMsgPreset('ref_only')}
              className="rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-extrabold text-white shadow-2xs transition hover:bg-sky-700"
            >
              ⚡ Sadece Referans (Sade)
            </button>
            <button
              type="button"
              onClick={() => applyMsgPreset('standard')}
              className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-200"
            >
              📋 Bölüm + Referans + Tanım
            </button>
            <button
              type="button"
              onClick={() => applyMsgPreset('full')}
              className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-200"
            >
              🔍 Tüm Detaylar
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          {/* Sol: Seçilebilir Alan Kutucukları */}
          <div className="space-y-4 lg:col-span-7">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {(
                [
                  {
                    key: 'show_reference',
                    label: '📦 Referans Kodu',
                    desc: 'Örn: KM-1042',
                  },
                  {
                    key: 'show_section',
                    label: '🟦 Bölüm Adı',
                    desc: 'Örn: ÖN MİNDER',
                  },
                  {
                    key: 'show_description',
                    label: '📝 Komponent Tanımı',
                    desc: 'Ürün açıklaması',
                  },
                  {
                    key: 'show_title',
                    label: '🚨 Başlık & Talep No',
                    desc: 'KOMPONENT RAF TALEBİ #4',
                  },
                  {
                    key: 'show_shelf',
                    label: '📍 Raf / Göz Kodu',
                    desc: 'Örn: ÖM-A01',
                  },
                  {
                    key: 'show_unit',
                    label: '📐 Birim / Paket',
                    desc: 'Örn: Bağ / 25 Adet',
                  },
                  {
                    key: 'show_time',
                    label: '🕒 Talep Saati',
                    desc: 'Tarih ve saat bilgisi',
                  },
                  {
                    key: 'show_footer_hint',
                    label: '💬 Alt Yönlendirme Yazısı',
                    desc: 'Ürün rafa bırakıldığında...',
                  },
                  {
                    key: 'show_complete_button',
                    label: '✅ Rafa Konuldu Butonu',
                    desc: 'Mesaj altı teslim butonu',
                  },
                  {
                    key: 'show_completed_by',
                    label: '👤 Teslim Eden Bilgisi',
                    desc: 'Kapandığında ismi göster',
                  },
                ] as const
              ).map((item) => {
                const checked = Boolean(msgConfig[item.key]);
                return (
                  <label
                    key={item.key}
                    onClick={() => toggleMsgField(item.key)}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 transition select-none ${
                      checked
                        ? 'border-sky-500 bg-sky-50/60 ring-1 ring-sky-200'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-extrabold text-slate-900">
                        {item.label}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {item.desc}
                      </div>
                    </div>
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded-md border ${
                        checked
                          ? 'border-sky-600 bg-sky-600 text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {checked && <Check className="h-3.5 w-3.5" />}
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="min-w-[220px] flex-1">
                <input
                  type="text"
                  value={msgConfig.custom_prefix}
                  onChange={(e) =>
                    setMsgConfig((prev) => ({
                      ...prev,
                      custom_prefix: e.target.value,
                    }))
                  }
                  placeholder="İsteğe bağlı özel üst not (boş bırakılabilir)"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold focus:border-sky-600 focus:outline-none"
                />
              </div>

              <button
                type="button"
                disabled={savingSettings}
                onClick={() => handleSaveSettings()}
                className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-xs font-extrabold text-white shadow-xs transition hover:bg-sky-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {savingSettings
                  ? 'Kaydediliyor...'
                  : 'Telegram Mesaj Filtresini Kaydet'}
              </button>
            </div>
          </div>

          {/* Sağ: Koyu Tema Gerçek Telegram Mesaj Balonu (Açık vs Kapalı Karşılaştırmalı Önizleme) */}
          <div className="space-y-3 rounded-2xl bg-[#0E1621] p-5 text-white shadow-inner lg:col-span-5">
            <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-slate-400 uppercase">
              <span>Telegram Sohbet Görünümü</span>
              <span className="text-emerald-400">Açık vs Kapalı Net Ayrım</span>
            </div>

            {/* 1. KAPALI / TESLİM EDİLMİŞ ÖRNEK BALON */}
            <div className="rounded-2xl bg-[#182533] p-3 text-[12px] leading-relaxed opacity-90 shadow-xs">
              <div className="rounded-lg border-l-[3px] border-emerald-400 bg-[#223344] px-3 py-2 text-slate-200">
                <div className="font-extrabold text-emerald-300">
                  ✅ KAPANDI{msgConfig.show_title ? ' #3' : ''} — TESLİM EDİLDİ
                </div>
                {msgConfig.show_section && (
                  <div>
                    🟦 <strong>Bölüm:</strong> ÖN MİNDER
                  </div>
                )}
                {(msgConfig.show_reference || tgLinesCount === 0) && (
                  <div>
                    📦 <strong>Referans:</strong>{' '}
                    <span className="font-mono text-sky-300">KM-1088</span>
                  </div>
                )}
                {msgConfig.show_description && (
                  <div>
                    📝 <strong>Tanım:</strong> Ön Burun Fitili Siyah PVC
                  </div>
                )}
                <div className="mt-0.5 text-[11px] text-slate-300">
                  {msgConfig.show_completed_by ? '👤 Ahmet Usta • ' : ''}🕒
                  13:45 (3 dk)
                </div>
              </div>
              <div className="mt-1 text-right text-[10px] text-slate-400">
                13:45
              </div>
            </div>

            {/* 2. AÇIK / BEKLEYEN ÖRNEK BALON */}
            <div>
              <div className="rounded-2xl bg-[#182533] p-3.5 text-[13px] leading-relaxed shadow-md ring-1 ring-rose-500/30">
                <div className="space-y-1 text-slate-100">
                  <div className="font-extrabold text-rose-400">
                    🔴 AÇIK TALEP{msgConfig.show_title ? ' #4' : ''} — BEKLİYOR
                  </div>
                  <div className="text-[11px] tracking-tighter text-slate-500 select-none">
                    ━━━━━━━━━━━━━━━
                  </div>

                  {msgConfig.custom_prefix.trim() && (
                    <div className="font-bold text-white">
                      📌 {msgConfig.custom_prefix.trim()}
                    </div>
                  )}

                  {msgConfig.show_section && (
                    <div>
                      🟦 <strong>Bölüm:</strong> ÖN MİNDER
                    </div>
                  )}

                  {(msgConfig.show_reference || tgLinesCount === 0) && (
                    <div>
                      📦 <strong>Referans:</strong>{' '}
                      <span className="font-mono text-sky-300">KM-1042</span>
                    </div>
                  )}

                  {msgConfig.show_description && (
                    <div>
                      📝 <strong>Tanım:</strong> Ön Minder Yan Kanat Lamine
                      Sünger
                    </div>
                  )}

                  {msgConfig.show_shelf && (
                    <div>
                      📍 <strong>Raf / Göz:</strong> ÖM-A01
                    </div>
                  )}

                  {msgConfig.show_unit && (
                    <div>
                      📐 <strong>Birim / Paket:</strong> Bağ / 25 Adet
                    </div>
                  )}

                  {msgConfig.show_time && (
                    <div>
                      🕒 <strong>Talep Saati:</strong> 18.11.2026 13:46
                    </div>
                  )}

                  {msgConfig.show_footer_hint &&
                    msgConfig.show_complete_button && (
                      <div className="pt-1.5 text-xs italic text-slate-300">
                        Ürün rafa bırakıldığında aşağıdaki butona basınız:
                      </div>
                    )}
                </div>

                <div className="mt-1 text-right text-[10px] text-slate-400">
                  13:46
                </div>
              </div>

              {msgConfig.show_complete_button && (
                <div className="mt-1.5 rounded-xl bg-[#203040] py-2.5 text-center text-xs font-bold text-white shadow-xs">
                  ✅ Rafa Konuldu / Teslim Edildi
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* KART 2: Akıllı Şirket Logosu & İnteraktif Canlı Etiket Önizlemesi */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <ImagePlus className="h-5 w-5 text-indigo-600" />
            <div>
              <h2 className="text-base font-black text-slate-900">
                Akıllı Şirket Logosu &amp; Canlı Etiket Boyutlandırma
              </h2>
              <p className="text-xs text-slate-500">
                PNG, JPG veya WebP fark etmeksizin yükleyin; sistem arka planı
                otomatik silip sadece logonuzu şeffaf olarak etikete yerleştirir.
              </p>
            </div>
          </div>

          {settings?.company_logo_data_url && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-700 ring-1 ring-emerald-200">
              <Sparkles className="h-3.5 w-3.5" />
              {logoMeta?.bg_removed
                ? `Arka Plan Otomatik Silindi (${logoMeta.original_format} → Şeffaf PNG)`
                : 'Şeffaf Logo Optimize Edildi & Kırpıldı'}
            </span>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          <div className="space-y-3.5 lg:col-span-5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleLogoFileSelected(e.target.files?.[0])}
              className="hidden"
            />

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleLogoFileSelected(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/70 p-5 text-center transition hover:border-indigo-500 hover:bg-indigo-50/40"
            >
              {settings?.company_logo_data_url ? (
                <>
                  <div
                    style={{
                      backgroundImage:
                        'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
                      backgroundSize: '14px 14px',
                      backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0px',
                    }}
                    className="flex h-20 items-center justify-center rounded-xl border border-slate-300 px-6 py-3 shadow-inner"
                  >
                    <img
                      src={settings.company_logo_data_url}
                      alt="Şirket Logosu"
                      className="max-h-14 max-w-[220px] object-contain"
                    />
                  </div>
                  <p className="mt-2.5 text-xs font-extrabold text-indigo-700">
                    Değiştirmek için tıklayın veya PNG / JPG / WebP sürükleyin
                  </p>
                </>
              ) : (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                    <Upload className="h-6 w-6" />
                  </div>
                  <p className="mt-3 text-sm font-extrabold text-slate-800">
                    {uploadingLogo
                      ? 'Akıllı logo işleniyor...'
                      : 'Logo Görseli Seçin veya Sürükleyin'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    PNG, JPG, JPEG veya WebP — Beyaz/renkli arka plan otomatik
                    silinir!
                  </p>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={uploadingLogo}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-extrabold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                {settings?.company_logo_data_url
                  ? 'Yeni Görsel Yükle'
                  : 'Logo Görseli Yükle'}
              </button>

              {settings?.company_logo_data_url && (
                <button
                  type="button"
                  disabled={uploadingLogo}
                  onClick={handleRemoveLogo}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Logoyu Kaldır
                </button>
              )}
            </div>

            {settings?.company_logo_data_url && (
              <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-700">
                    <Wand2 className="h-3.5 w-3.5 text-indigo-600" />
                    Akıllı Arka Plan Silici Modu
                  </span>
                  <div className="flex gap-1">
                    {(
                      [
                        { id: 'auto', label: 'Otomatik' },
                        { id: 'always', label: 'Zorla Sil' },
                        { id: 'never', label: 'Orijinal' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        disabled={uploadingLogo}
                        onClick={() => handleReprocessLogo(m.id, bgTolerance)}
                        className={`rounded-lg px-2 py-1 text-[11px] font-extrabold transition ${
                          bgMode === m.id
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {bgMode !== 'never' && (
                  <div className="flex items-center gap-2.5 pt-0.5">
                    <span className="text-[11px] font-bold whitespace-nowrap text-slate-500">
                      Temizlik Hassasiyeti:
                    </span>
                    <input
                      type="range"
                      min={12}
                      max={85}
                      value={bgTolerance}
                      onChange={(e) => setBgTolerance(Number(e.target.value))}
                      onMouseUp={() =>
                        handleReprocessLogo(
                          bgMode === 'auto' ? 'always' : bgMode,
                          bgTolerance
                        )
                      }
                      onTouchEnd={() =>
                        handleReprocessLogo(
                          bgMode === 'auto' ? 'always' : bgMode,
                          bgTolerance
                        )
                      }
                      className="h-1.5 flex-1 cursor-pointer accent-indigo-600"
                    />
                    <span className="w-8 text-right font-mono text-[11px] font-bold text-slate-700">
                      {bgTolerance}
                    </span>
                  </div>
                )}
              </div>
            )}

            {logoFeedback && (
              <div
                className={`rounded-xl px-3.5 py-2 text-xs font-bold ring-1 ${
                  logoFeedback.type === 'ok'
                    ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                    : 'bg-rose-50 text-rose-700 ring-rose-200'
                }`}
              >
                {logoFeedback.msg}
              </div>
            )}
          </div>

          <div className="flex flex-col items-center justify-between rounded-2xl border border-slate-200 bg-slate-100/80 p-5 lg:col-span-7">
            <div className="mb-3 flex w-full flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold tracking-wide text-slate-600 uppercase">
                Canlı Raf Etiketi Önizlemesi (97 × 57 mm)
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-slate-500">
                  Renk Testi:
                </span>
                {sections.map((sec, idx) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setPreviewSecIdx(idx)}
                    style={{ backgroundColor: sec.color_hex }}
                    title={`${sec.name} renginde önizle`}
                    className={`h-5 w-5 rounded-full transition ${
                      previewSecIdx === idx
                        ? 'scale-110 ring-2 ring-slate-900 ring-offset-2'
                        : 'opacity-75 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="my-2 flex items-center justify-center">
              <ShelfLabelCard
                item={previewItem}
                baseUrl={publicUrl}
                logoUrl={settings?.company_logo_data_url}
                logoScale={logoScale}
                logoPlacement="header_badge"
                widthMm={97}
                heightMm={57}
                colorStyle="band"
                showCutGuides={false}
              />
            </div>

            <div className="mt-4 flex w-full flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-2.5 shadow-2xs ring-1 ring-slate-200">
              <span className="text-xs font-extrabold text-slate-700">
                Etiket Üzerindeki Logo Boyutu:
              </span>

              <div className="flex flex-1 items-center gap-2 sm:max-w-xs">
                <button
                  type="button"
                  onClick={() => handleLogoScaleChange(logoScale - 10)}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                  title="Küçült"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>

                <input
                  type="range"
                  min={40}
                  max={240}
                  step={5}
                  value={logoScale}
                  onChange={(e) =>
                    handleLogoScaleChange(Number(e.target.value))
                  }
                  className="h-2 flex-1 cursor-pointer accent-indigo-600"
                />

                <button
                  type="button"
                  onClick={() => handleLogoScaleChange(logoScale + 10)}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                  title="Büyüt"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>

                <span className="w-13 text-right font-mono text-xs font-black text-indigo-700">
                  %{logoScale}
                </span>

                {logoScale !== 100 && (
                  <button
                    type="button"
                    onClick={() => handleLogoScaleChange(100)}
                    title="%100 Varsayılan boyuta sıfırla"
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Alt İki Kolon: Bölüm Renkleri + Telegram Bot & Grup Ayarları */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Sol Kolon: Bölüm & Renk Yönetimi */}
        <div className="space-y-6 lg:col-span-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
              <Palette className="h-5 w-5 text-blue-600" />
              <div>
                <h2 className="text-base font-black text-slate-900">
                  Dikiş Bölümleri ve Etiket Renkleri
                </h2>
                <p className="text-xs text-slate-500">
                  Her bölümün A4 çıktıda ayırt edilmesini sağlayan dikkat çekici
                  rengini buradan özelleştirebilirsiniz.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {sections.map((sec) => {
                const fg = getContrastText(sec.color_hex);
                return (
                  <div
                    key={sec.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        style={{ backgroundColor: sec.color_hex, color: fg }}
                        className="inline-flex min-w-[125px] justify-center rounded-lg px-3 py-1.5 text-xs font-black tracking-wider uppercase shadow-2xs"
                      >
                        {sec.name}
                      </span>
                      <input
                        type="text"
                        defaultValue={sec.name}
                        onBlur={(e) =>
                          handleUpdateSectionName(sec, e.target.value)
                        }
                        className="w-36 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-700 focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      {INDUSTRIAL_PALETTE.slice(0, 6).map((swatch) => (
                        <button
                          key={swatch}
                          type="button"
                          onClick={() => handleUpdateSectionColor(sec, swatch)}
                          style={{ backgroundColor: swatch }}
                          className={`h-6 w-6 rounded-full transition hover:scale-110 ${
                            sec.color_hex.toUpperCase() === swatch
                              ? 'ring-2 ring-slate-900 ring-offset-2'
                              : ''
                          }`}
                          title={swatch}
                        />
                      ))}

                      <input
                        type="color"
                        value={sec.color_hex}
                        onChange={(e) =>
                          handleUpdateSectionColor(sec, e.target.value)
                        }
                        title="Özel renk seç"
                        className="ml-1 h-7 w-8 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                      />

                      {sec.item_count === 0 && sections.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSection(sec)}
                          title="Boş bölümü sil"
                          className="ml-1 rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <form
              onSubmit={handleCreateSection}
              className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4"
            >
              <input
                type="text"
                value={newSecName}
                onChange={(e) => setNewSecName(e.target.value)}
                placeholder="Yeni bölüm / raf adı (örn: Başlık Bandı)"
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold focus:border-blue-600 focus:outline-none"
              />
              <input
                type="color"
                value={newSecColor}
                onChange={(e) => setNewSecColor(e.target.value)}
                className="h-9 w-11 cursor-pointer rounded-xl border border-slate-300 bg-white p-1"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Ekle
              </button>
            </form>
          </div>
        </div>

        {/* Sağ Kolon: Telegram Bot Bağlantısı & Buton Durumu */}
        <div className="space-y-6 lg:col-span-6">
          <form
            onSubmit={handleSaveSettings}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs"
          >
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
              <Send className="h-5 w-5 text-sky-600" />
              <div>
                <h2 className="text-base font-black text-slate-900">
                  Telegram Depo Grubu &amp; Buton Bağlantı Durumu
                </h2>
                <p className="text-xs text-slate-500">
                  Bot Token, Depo Grup ID ve &quot;Rafa Konuldu&quot; butonu
                  canlı bağlantı kontrolü.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {/* Canlı Bot Dinleyici & 409 Çakışma Teşhis Kutusu */}
              {pollingStatus === 'conflict_409' && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <div className="space-y-1.5">
                      <div className="font-black text-amber-900">
                        Neden &quot;Rafa Konuldu&quot; Butonu Tıklanmadı? (Bot
                        Çakışması — HTTP 409)
                      </div>
                      <p className="leading-relaxed text-amber-800">
                        Şu an bağlı olan bot (<code>NotificationBot</code>) aynı
                        anda <strong>başka bir sunucu/projenizde daha</strong>{' '}
                        aktif olarak dinleniyor. Telegram kuralları gereği bir
                        botu iki farklı uygulama aynı anda dinleyemez; diğer
                        uygulama buton tıklama bildirimlerini düşürüyor.
                      </p>
                      <div className="rounded-xl bg-white/80 p-2.5 font-semibold text-amber-950 ring-1 ring-amber-200">
                        ✅ <strong>Kesin Çözüm:</strong> Telegram&apos;da{' '}
                        <code>@BotFather</code>&apos;a gidip{' '}
                        <code>/newbot</code> yazarak sadece bu raf sistemine
                        özel yeni bir bot açın, onu depo grubuna ekleyip yeni
                        Token&apos;ı aşağıya kaydedin. Telegram içi buton anında
                        çalışmaya başlayacaktır!
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {pollingStatus === 'ok' && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-extrabold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  Telegram İçi &quot;Rafa Konuldu&quot; Buton Dinleyicisi Aktif
                  ve Sorunsuz Çalışıyor!
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Uygulama / Tesis Başlığı
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-bold focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>Telegram Bot Token</span>
                  {settings?.telegram_bot_token_configured && (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <Check className="h-3.5 w-3.5" /> Kayıtlı (
                      {settings.telegram_bot_token_masked})
                    </span>
                  )}
                </label>
                <input
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder={
                    settings?.telegram_bot_token_configured
                      ? 'Yeni özel bot token yapıştırın (boş bırakılırsa mevcut korunur)'
                      : 'Örn: 7412345678:AAH...'
                  }
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-xs focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700">
                    Depo Telegram Grup Chat ID
                  </label>
                  <button
                    type="button"
                    disabled={discovering}
                    onClick={handleDiscoverChats}
                    className="inline-flex items-center gap-1 text-xs font-extrabold text-sky-700 hover:underline disabled:opacity-50"
                  >
                    <Radio className="h-3.5 w-3.5" />
                    {discovering ? 'Aranıyor...' : 'Grupları Otomatik Bul'}
                  </button>
                </div>
                <input
                  type="text"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="Örn: -1002145896321"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-xs font-bold focus:border-blue-600 focus:outline-none"
                />

                {recentChats.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {recentChats.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setChatId(c.id)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                          chatId === c.id
                            ? 'bg-sky-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {c.title} ({c.id})
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="mb-1 flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <Globe className="h-3.5 w-3.5 text-slate-500" />
                    Etiket QR Kod Erişim Adresi (Public URL)
                  </label>
                  <button
                    type="button"
                    onClick={() => setPublicUrl(window.location.origin)}
                    className="text-xs font-bold text-blue-600 hover:underline"
                  >
                    Bu Tarayıcı Adresini Kullan
                  </button>
                </div>
                <input
                  type="url"
                  required
                  value={publicUrl}
                  onChange={(e) => setPublicUrl(e.target.value)}
                  placeholder="https://raf.sirketiniz.com"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-xs font-semibold focus:border-blue-600 focus:outline-none"
                />
              </div>

              {feedback && (
                <div
                  className={`rounded-xl px-4 py-2.5 text-xs font-bold ring-1 ${
                    feedback.type === 'ok'
                      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                      : 'bg-rose-50 text-rose-700 ring-rose-200'
                  }`}
                >
                  {feedback.msg}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  disabled={testingTelegram}
                  onClick={handleSendTestMessage}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-sky-300 bg-sky-50 px-4 py-2.5 text-xs font-extrabold text-sky-800 transition hover:bg-sky-100 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {testingTelegram
                    ? 'Gönderiliyor...'
                    : 'Telegram Test Mesajı Gönder'}
                </button>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-extrabold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {savingSettings ? 'Kaydediliyor...' : 'Tüm Ayarları Kaydet'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Logo Silme Onay Modalı */}
      <ConfirmModal
        open={confirmRemoveLogo}
        title="Şirket Logosunu Kaldırmak İstediğinize Emin misiniz?"
        description="Kayıtlı şirket logosu kaldırılacak ve basılacak etiketlerde logo gösterilmeyecektir."
        confirmLabel="Evet, Logoyu Kaldır"
        cancelLabel="Vazgeç"
        loading={uploadingLogo}
        onConfirm={executeRemoveLogo}
        onCancel={() => setConfirmRemoveLogo(false)}
      />

      {/* Bölüm Silme Onay Modalı */}
      <ConfirmModal
        open={pendingDeleteSec !== null}
        title="Bölümü Silmek İstediğinize Emin misiniz?"
        highlightText={pendingDeleteSec?.name}
        description="Seçilen dikiş bölümü sistemden kalıcı olarak kaldırılacaktır."
        confirmLabel="Evet, Bölümü Sil"
        cancelLabel="Vazgeç"
        onConfirm={executeDeleteSection}
        onCancel={() => setPendingDeleteSec(null)}
      />
    </div>
  );
}
