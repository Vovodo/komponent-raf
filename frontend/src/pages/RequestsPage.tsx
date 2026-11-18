import {
  CheckCircle2,
  Clock,
  MapPin,
  Send,
  UserCheck,
  Wifi,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ReplenishmentRequest, Section } from '../types';
import {
  formatDateTimeTR,
  formatTimeTR,
  getContrastText,
  getEffectiveSection,
} from '../utils/color';

interface RequestsPageProps {
  sections: Section[];
  realtimeRevision: number;
  wsConnected: boolean;
  onGlobalRefresh: () => Promise<void>;
}

export function RequestsPage({
  sections,
  realtimeRevision,
  wsConnected,
  onGlobalRefresh,
}: RequestsPageProps) {
  const [requests, setRequests] = useState<ReplenishmentRequest[]>([]);
  const [filterSectionId, setFilterSectionId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadRequests = useCallback(async () => {
    const data = await api.getRequests({
      status: 'ALL',
      section_id: filterSectionId,
    });
    setRequests(data);
  }, [filterSectionId]);

  // İlk yükleme + filtre değişimi + her WebSocket anlık olayında 0 gecikmeyle güncelle
  useEffect(() => {
    loadRequests();
  }, [loadRequests, realtimeRevision]);

  const pendingList = requests.filter((r) => r.status === 'PENDING');
  const completedList = requests.filter((r) => r.status === 'COMPLETED');

  const handleComplete = async (reqId: number) => {
    setBusyId(reqId);
    try {
      await api.completeRequest(reqId, 'Web Depo Paneli');
      await loadRequests();
      await onGlobalRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (reqId: number) => {
    setBusyId(reqId);
    try {
      await api.cancelRequest(reqId);
      await loadRequests();
      await onGlobalRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleCompleteAll = async () => {
    if (pendingList.length === 0) return;
    setBusyId(-1);
    try {
      await api.completeAllPendingRequests('Web Depo Paneli');
      await loadRequests();
      await onGlobalRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleRetryTelegram = async (reqId: number) => {
    setBusyId(reqId);
    try {
      await api.retryTelegram(reqId);
      await loadRequests();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Üst Filtre ve Canlı WebSocket Göstergesi */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterSectionId(null)}
            className={`rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
              filterSectionId === null
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100'
            }`}
          >
            Tüm Bölümler
          </button>
          {sections.map((sec) => {
            const active = filterSectionId === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setFilterSectionId(active ? null : sec.id)}
                style={
                  active
                    ? {
                        backgroundColor: sec.color_hex,
                        color: getContrastText(sec.color_hex),
                      }
                    : undefined
                }
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
                  active
                    ? 'shadow-xs'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100'
                }`}
              >
                <span
                  style={{
                    backgroundColor: active
                      ? getContrastText(sec.color_hex)
                      : sec.color_hex,
                  }}
                  className="h-2.5 w-2.5 rounded-full"
                />
                {sec.name}
              </button>
            );
          })}
        </div>

        <div
          className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-extrabold ${
            wsConnected
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <Wifi className="h-3.5 w-3.5" />
          {wsConnected
            ? 'WebSocket Canlı Akış Aktif (Anlık)'
            : 'Yeniden Bağlanıyor...'}
        </div>
      </div>

      {/* Açık / Bekleyen Talepler */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-black text-slate-900">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-xs font-black text-white">
              {pendingList.length}
            </span>
            Bekleyen Açık Raf Talepleri
          </h2>

          {pendingList.length > 0 && (
            <button
              type="button"
              disabled={busyId === -1}
              onClick={handleCompleteAll}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {busyId === -1
                ? 'Kapatılıyor...'
                : `Tüm Bekleyenleri Kapat (${pendingList.length})`}
            </button>
          )}
        </div>

        {pendingList.length === 0 ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-8 text-center">
            <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" />
            <p className="mt-2 text-sm font-extrabold text-emerald-900">
              Şu anda bekleyen açık komponent talebi yok!
            </p>
            <p className="mt-0.5 text-xs text-emerald-700">
              Dikiş operatörleri raftaki QR kodu okuttuğu salise WebSocket ile
              tüm ekranlara ve Telegram&apos;a canlı düşer.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pendingList.map((req) => {
              const sec = getEffectiveSection(req.item.section);
              const fg = getContrastText(sec.color_hex);
              return (
                <div
                  key={req.id}
                  style={{ borderColor: sec.color_hex }}
                  className="flex flex-col justify-between overflow-hidden rounded-2xl border-2 bg-white shadow-sm"
                >
                  <div>
                    <div
                      style={{ backgroundColor: sec.color_hex, color: fg }}
                      className="flex items-center justify-between px-4 py-2.5"
                    >
                      <span className="text-xs font-black tracking-wider uppercase">
                        {sec.name}
                      </span>
                      <span className="rounded bg-black/20 px-2 py-0.5 font-mono text-xs font-bold">
                        Talep #{req.id}
                      </span>
                    </div>

                    <div className="p-4">
                      <div className="font-mono text-2xl font-black text-slate-950">
                        {req.item.reference_code}
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-700">
                        {req.item.description}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                        {req.item.shelf_code && (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 font-bold">
                            <MapPin className="h-3.5 w-3.5" />
                            Raf: {req.item.shelf_code}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 font-bold text-amber-800">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDateTimeTR(req.requested_at)}
                        </span>
                        {req.scan_count > 1 && (
                          <span className="rounded-lg bg-rose-50 px-2 py-1 font-bold text-rose-700">
                            {req.scan_count}× okutuldu
                          </span>
                        )}
                      </div>

                      <div className="mt-3 text-xs">
                        {req.telegram_sent ? (
                          <span className="inline-flex items-center gap-1 font-bold text-sky-700">
                            <Send className="h-3 w-3" /> Telegram grubunda aktif
                          </span>
                        ) : (
                          <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-amber-800">
                            <span className="truncate">
                              {req.telegram_error || 'Telegram iletilmedi'}
                            </span>
                            <button
                              type="button"
                              disabled={busyId === req.id}
                              onClick={() => handleRetryTelegram(req.id)}
                              className="shrink-0 font-extrabold underline"
                            >
                              Tekrar Gönder
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50 p-3">
                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => handleComplete(req.id)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Rafa Konuldu / Kapat
                    </button>

                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => handleCancel(req.id)}
                      title="Talebi iptal et"
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tamamlanan Geçmiş Talepler */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-sm font-extrabold text-slate-800">
            Karşılanan Talep Geçmişi ({completedList.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-extrabold text-slate-600 uppercase">
                <th className="px-4 py-3">No</th>
                <th className="px-4 py-3">Bölüm</th>
                <th className="px-4 py-3">Referans</th>
                <th className="px-4 py-3">Tanım</th>
                <th className="px-4 py-3">Talep → Teslim</th>
                <th className="px-4 py-3">Karşılayan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {completedList.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-xs text-slate-400"
                  >
                    Henüz tamamlanmış talep bulunmuyor.
                  </td>
                </tr>
              ) : (
                completedList.map((req) => {
                  const sec = getEffectiveSection(req.item.section);
                  const diffMin =
                    req.completed_at && req.requested_at
                      ? Math.max(
                          1,
                          Math.round(
                            (new Date(req.completed_at).getTime() -
                              new Date(req.requested_at).getTime()) /
                              60000
                          )
                        )
                      : null;
                  return (
                    <tr key={req.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs font-bold text-slate-500">
                        #{req.id}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          style={{
                            backgroundColor: sec.color_hex,
                            color: getContrastText(sec.color_hex),
                          }}
                          className="rounded-md px-2 py-0.5 text-xs font-extrabold uppercase"
                        >
                          {sec.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono font-black text-slate-900">
                        {req.item.reference_code}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700">
                        {req.item.description}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                        {formatTimeTR(req.requested_at)} →{' '}
                        {formatTimeTR(req.completed_at)}
                        {diffMin !== null && (
                          <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700">
                            {diffMin} dk
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-slate-700">
                        <span className="inline-flex items-center gap-1">
                          <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                          {req.completed_by || 'Depo'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
