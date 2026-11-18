import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock,
  Layers,
  Lock,
  Package,
  Printer,
  Save,
  Settings,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import {
  api,
  setAdminMemoryToken,
  setOnUnauthorizedHandler,
} from './api';
import { PinLockScreen } from './components/PinLockScreen';
import { useRealtimeSocket } from './hooks/useRealtimeSocket';
import { PrintLabelsPage } from './pages/PrintLabelsPage';
import { ReferencesPage } from './pages/ReferencesPage';
import { RequestsPage } from './pages/RequestsPage';
import { ScanTriggerPage } from './pages/ScanTriggerPage';
import { SettingsPage } from './pages/SettingsPage';
import type {
  AppSettings,
  ComponentItem,
  DashboardStats,
  RealtimeWsEvent,
  Section,
} from './types';

function AdminWorkspace({ onLock }: { onLock: () => void }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [items, setItems] = useState<ComponentItem[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [realtimeRevision, setRealtimeRevision] = useState(0);
  const [quickNewToken, setQuickNewToken] = useState('');
  const [savingQuickToken, setSavingQuickToken] = useState(false);

  const refreshAll = useCallback(async () => {
    try {
      const [secData, itemData, statData, setRes] = await Promise.all([
        api.getSections(),
        api.getItems(),
        api.getStats(),
        api.getSettings(),
      ]);
      setSections(secData);
      setItems(itemData);
      setStats(statData);
      setSettings(setRes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // WebSocket ile QR okutma, Telegram onay, ürün veya logo değişimlerini tüm cihazlarda anında yansıt!
  const handleRealtimeEvent = useCallback((evt: RealtimeWsEvent) => {
    setRealtimeRevision((r) => r + 1);

    if (evt.type === 'REQUEST_UPDATED') {
      // Hem Referanslar tablosundaki "Talep Durumu" sütununu hem üst sayaçları anında güncelle
      Promise.all([api.getItems(), api.getStats()])
        .then(([freshItems, freshStats]) => {
          setItems(freshItems);
          setStats(freshStats);
        })
        .catch(() => {});
    } else if (evt.type === 'CATALOG_UPDATED') {
      Promise.all([api.getSections(), api.getItems(), api.getStats()])
        .then(([freshSec, freshItems, freshStats]) => {
          setSections(freshSec);
          setItems(freshItems);
          setStats(freshStats);
        })
        .catch(() => {});
    } else if (evt.type === 'SETTINGS_UPDATED') {
      api
        .getSettings()
        .then(setSettings)
        .catch(() => {});
    }
  }, []);

  const { connected: wsConnected } = useRealtimeSocket(handleRealtimeEvent);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Üst Başlık ve Sekmeler (Yazdırma sırasında tamamen gizlenir) */}
      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            {settings?.company_logo_data_url ? (
              <div className="flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 py-1 shadow-2xs">
                <img
                  src={settings.company_logo_data_url}
                  alt="Logo"
                  className="max-h-7 max-w-[110px] object-contain"
                />
              </div>
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs">
                <Layers className="h-5 w-5" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-black tracking-tight text-slate-950 sm:text-lg">
                  {settings?.company_name || 'Dikişhane Komponent Rafı'}
                </h1>
                <span
                  title={
                    wsConnected
                      ? 'WebSocket Canlı Bağlantı Aktif — Tüm cihazlarla senkron'
                      : 'Canlı bağlantı yeniden kuruluyor...'
                  }
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-wide uppercase ${
                    wsConnected
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      wsConnected
                        ? 'animate-pulse bg-emerald-500'
                        : 'bg-amber-500'
                    }`}
                  />
                  {wsConnected ? 'Canlı' : 'Bağlanıyor'}
                </span>
              </div>
              <p className="text-xs font-medium text-slate-500">
                Renkli QR Raf Etiketi &amp; Telegram Anlık Talep Sistemi
              </p>
            </div>
          </div>

          {/* Özet Metrik Rozetleri */}
          {stats && (
            <div className="hidden items-center gap-2.5 xl:flex">
              <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5 text-xs">
                <Package className="h-4 w-4 text-slate-600" />
                <span className="text-slate-600">Referans:</span>
                <strong className="font-black text-slate-900">
                  {stats.total_items}
                </strong>
              </div>

              <div
                className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs ${
                  stats.pending_requests > 0
                    ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                <Clock className="h-4 w-4" />
                <span>Açık Talep:</span>
                <strong className="font-black">{stats.pending_requests}</strong>
              </div>

              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>Bugün Teslim:</span>
                <strong className="font-black">{stats.completed_today}</strong>
                {stats.avg_completion_minutes !== null && (
                  <span className="text-emerald-600">
                    (~{stats.avg_completion_minutes} dk)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Ana Navigasyon */}
          <nav className="flex items-center gap-1.5">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100'
                }`
              }
            >
              <Package className="h-4 w-4" />
              Referanslar
            </NavLink>

            <NavLink
              to="/yazdir"
              className={({ isActive }) =>
                `inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100'
                }`
              }
            >
              <Printer className="h-4 w-4" />
              A4 Etiket Yazdır
              {selectedIds.length > 0 && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-black text-blue-800">
                  {selectedIds.length}
                </span>
              )}
            </NavLink>

            <NavLink
              to="/talepler"
              className={({ isActive }) =>
                `inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100'
                }`
              }
            >
              <BellRing className="h-4 w-4" />
              Talepler
              {stats && stats.pending_requests > 0 && (
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-black text-white">
                  {stats.pending_requests}
                </span>
              )}
            </NavLink>

            <NavLink
              to="/ayarlar"
              className={({ isActive }) =>
                `inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100'
                }`
              }
            >
              <Settings className="h-4 w-4" />
              Bölüm &amp; Telegram
            </NavLink>

            <button
              type="button"
              onClick={onLock}
              title="Ekranı kilitle"
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-200 hover:text-slate-900"
            >
              <Lock className="h-3.5 w-3.5" />
            </button>
          </nav>
        </div>
      </header>

      {/* Ortak Bot (NotificationBot) 409 Çakışma Hızlı Çözüm Çubuğu */}
      {settings?.telegram_polling_status === 'conflict_409' && (
        <div className="no-print border-b border-amber-300 bg-amber-50">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-start gap-2.5 text-xs text-amber-950">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <strong className="font-black">
                  Telegram &quot;Rafa Konuldu&quot; Butonu Neden Tepki Vermiyor?
                  (Ortak Bot Çakışması):
                </strong>{' '}
                Şu an bağlı olan <code>NotificationBot</code>, sunucunuzdaki{' '}
                <strong>Paketleme</strong> uygulamasında da aynı anda çalıştığı
                için Telegram tıklamaları diğer sunucuya gidiyor.{' '}
                <code>@BotFather</code> → <code>/newbot</code> ile bu sisteme
                özel yeni bir bot açıp gruba ekleyin ve Token&apos;ını buraya
                yapıştırın:
              </div>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!quickNewToken.trim()) return;
                setSavingQuickToken(true);
                try {
                  await api.saveSettings({
                    telegram_bot_token: quickNewToken.trim(),
                    telegram_chat_id: settings.telegram_chat_id,
                    public_base_url: settings.public_base_url,
                    company_name: settings.company_name,
                    telegram_message_config: settings.telegram_message_config,
                  });
                  setQuickNewToken('');
                  await refreshAll();
                } catch (err) {
                  alert((err as Error).message);
                } finally {
                  setSavingQuickToken(false);
                }
              }}
              className="flex w-full items-center gap-2 sm:w-auto"
            >
              <input
                type="password"
                value={quickNewToken}
                onChange={(e) => setQuickNewToken(e.target.value)}
                placeholder="Yeni özel Bot Token yapıştırın..."
                className="min-w-[230px] flex-1 rounded-xl border border-amber-300 bg-white px-3 py-1.5 font-mono text-xs focus:border-amber-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={savingQuickToken || !quickNewToken.trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-1.5 text-xs font-black text-white shadow-2xs transition hover:bg-amber-700 disabled:opacity-40"
              >
                <Save className="h-3.5 w-3.5" />
                {savingQuickToken ? 'Kaydediliyor...' : 'Yeni Botu Bağla'}
              </button>
            </form>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 print:max-w-none print:p-0">
        {loading ? (
          <div className="py-20 text-center text-sm font-bold text-slate-500">
            Veriler yükleniyor...
          </div>
        ) : (
          <Routes>
            <Route
              path="/"
              element={
                <ReferencesPage
                  sections={sections}
                  items={items}
                  selectedIds={selectedIds}
                  setSelectedIds={setSelectedIds}
                  onRefresh={refreshAll}
                />
              }
            />
            <Route
              path="/yazdir"
              element={
                <PrintLabelsPage
                  sections={sections}
                  items={items}
                  selectedIds={selectedIds}
                  setSelectedIds={setSelectedIds}
                  settings={settings}
                />
              }
            />
            <Route
              path="/talepler"
              element={
                <RequestsPage
                  sections={sections}
                  realtimeRevision={realtimeRevision}
                  wsConnected={wsConnected}
                  onGlobalRefresh={refreshAll}
                />
              }
            />
            <Route
              path="/ayarlar"
              element={
                <SettingsPage
                  sections={sections}
                  settings={settings}
                  onRefresh={refreshAll}
                />
              }
            />
          </Routes>
        )}
      </main>
    </div>
  );
}

function AppRouterSwitch() {
  const location = useLocation();
  // Çerez, localStorage veya sessionStorage KULLANILMAZ; sayfa her açıldığında/yenilendiğinde PIN ister!
  const [pinUnlocked, setPinUnlocked] = useState(false);

  useEffect(() => {
    setOnUnauthorizedHandler(() => {
      setAdminMemoryToken(null);
      setPinUnlocked(false);
    });
    return () => setOnUnauthorizedHandler(null);
  }, []);

  if (location.pathname === '/t' || location.pathname.startsWith('/t/')) {
    return (
      <Routes>
        <Route path="/t" element={<ScanTriggerPage />} />
        <Route path="/t/:qrToken" element={<ScanTriggerPage />} />
      </Routes>
    );
  }

  if (!pinUnlocked) {
    return <PinLockScreen onUnlocked={() => setPinUnlocked(true)} />;
  }

  return (
    <AdminWorkspace
      onLock={() => {
        setAdminMemoryToken(null);
        setPinUnlocked(false);
      }}
    />
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRouterSwitch />
    </BrowserRouter>
  );
}
