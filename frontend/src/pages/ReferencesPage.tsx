import {
  Check,
  CheckCircle2,
  CheckSquare,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  Plus,
  Printer,
  Search,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ConfirmModal } from '../components/ConfirmModal';
import { SmartExcelImportModal } from '../components/SmartExcelImportModal';
import type { ComponentItem, Section } from '../types';
import {
  getContrastText,
  getEffectiveSection,
  hexWithAlpha,
} from '../utils/color';

interface ReferencesPageProps {
  sections: Section[];
  items: ComponentItem[];
  selectedIds: number[];
  setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>;
  onRefresh: () => Promise<void>;
}

export function ReferencesPage({
  sections,
  items,
  selectedIds,
  setSelectedIds,
  onRefresh,
}: ReferencesPageProps) {
  const navigate = useNavigate();
  const refInputRef = useRef<HTMLInputElement>(null);

  // Filtreler: null = Tümü, 'UNASSIGNED' = Bölüm Seçilmeyenler, number = Belirli Bölüm
  const [filterMode, setFilterMode] = useState<'ALL' | 'UNASSIGNED' | number>(
    'ALL'
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Hızlı Ekle Formu
  const [newRef, setNewRef] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newShelf, setNewShelf] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [selectedFormSections, setSelectedFormSections] = useState<number[]>(
    () => (sections[0] ? [sections[0].id] : [])
  );
  const [saving, setSaving] = useState(false);
  const [closingReqId, setClosingReqId] = useState<number | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  const [assigningItemId, setAssigningItemId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Düzenleme Modalı
  const [editingItem, setEditingItem] = useState<ComponentItem | null>(null);
  const [editRef, setEditRef] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editSectionId, setEditSectionId] = useState<number | null>(null);
  const [editShelf, setEditShelf] = useState('');
  const [editUnit, setEditUnit] = useState('');

  // Akıllı Excel İçe Aktarma Sihirbazı Modalı
  const [showBulkModal, setShowBulkModal] = useState(false);

  // Silme Onay Modalı State
  const [pendingDeleteItem, setPendingDeleteItem] =
    useState<ComponentItem | null>(null);
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const unassignedCount = useMemo(
    () => items.filter((i) => i.section_id === null).length,
    [items]
  );

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
    return items.filter((it) => {
      if (filterMode === 'UNASSIGNED' && it.section_id !== null) {
        return false;
      }
      if (typeof filterMode === 'number' && it.section_id !== filterMode) {
        return false;
      }
      if (!q) return true;
      const secName = it.section?.name || 'Bölüm Seçilmedi';
      return (
        it.reference_code.toLocaleLowerCase('tr-TR').includes(q) ||
        it.description.toLocaleLowerCase('tr-TR').includes(q) ||
        (it.shelf_code || '').toLocaleLowerCase('tr-TR').includes(q) ||
        secName.toLocaleLowerCase('tr-TR').includes(q)
      );
    });
  }, [items, filterMode, searchQuery]);

  const allFilteredSelected =
    filteredItems.length > 0 &&
    filteredItems.every((it) => selectedIds.includes(it.id));

  const toggleSelectAllFiltered = () => {
    const visibleIds = filteredItems.map((it) => it.id);
    if (allFilteredSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleFormSection = (secId: number) => {
    setSelectedFormSections((prev) =>
      prev.includes(secId) ? prev.filter((x) => x !== secId) : [...prev, secId]
    );
  };

  const handleQuickCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRef.trim() || !newDesc.trim()) {
      setFormError('Referans kodu ve tanım alanları zorunludur.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api.createItems({
        reference_code: newRef.trim(),
        description: newDesc.trim(),
        section_ids: selectedFormSections,
        shelf_code: newShelf.trim() || undefined,
        unit_info: newUnit.trim() || undefined,
      });
      setNewRef('');
      setNewDesc('');
      setNewShelf('');
      setNewUnit('');
      await onRefresh();
      refInputRef.current?.focus();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Satır içinden modal açmadan TEK TIKLA bölüm rengi atama / değiştirme!
  const handleInlineAssignSection = async (
    itemId: number,
    nextSectionId: number | null
  ) => {
    setAssigningItemId(itemId);
    try {
      await api.updateItem(itemId, { section_id: nextSectionId });
      await onRefresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setAssigningItemId(null);
    }
  };

  // Seçili çoklu satırlara tek seferde bölüm atama
  const handleBulkAssignSection = async (nextSectionId: number | null) => {
    if (selectedIds.length === 0) return;
    try {
      await api.bulkAssignSection(selectedIds, nextSectionId);
      await onRefresh();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const openEditModal = (item: ComponentItem) => {
    setEditingItem(item);
    setEditRef(item.reference_code);
    setEditDesc(item.description);
    setEditSectionId(item.section_id);
    setEditShelf(item.shelf_code || '');
    setEditUnit(item.unit_info || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    try {
      await api.updateItem(editingItem.id, {
        reference_code: editRef,
        description: editDesc,
        section_id: editSectionId,
        shelf_code: editShelf,
        unit_info: editUnit,
      });
      setEditingItem(null);
      await onRefresh();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleDeleteOne = (item: ComponentItem) => {
    setPendingDeleteItem(item);
  };

  const executeConfirmDeleteOne = async () => {
    if (!pendingDeleteItem) return;
    setDeletingBusy(true);
    try {
      await api.deleteItem(pendingDeleteItem.id);
      setSelectedIds((prev) =>
        prev.filter((id) => id !== pendingDeleteItem.id)
      );
      setPendingDeleteItem(null);
      await onRefresh();
    } finally {
      setDeletingBusy(false);
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    setConfirmingBulkDelete(true);
  };

  const executeConfirmBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setDeletingBusy(true);
    try {
      await api.bulkDeleteItems(selectedIds);
      setSelectedIds([]);
      setConfirmingBulkDelete(false);
      await onRefresh();
    } finally {
      setDeletingBusy(false);
    }
  };

  const handlePrintSingle = (item: ComponentItem) => {
    setSelectedIds([item.id]);
    navigate('/yazdir');
  };

  const handleLoadDemo = async () => {
    await api.seedDemoItems();
    await onRefresh();
  };

  const pendingItemsCount = useMemo(
    () => items.filter((i) => i.has_pending_request).length,
    [items]
  );

  const handleCloseFromTable = async (reqId: number | null) => {
    if (!reqId) return;
    setClosingReqId(reqId);
    try {
      await api.completeRequest(reqId, 'Uygulama Paneli');
      await onRefresh();
    } finally {
      setClosingReqId(null);
    }
  };

  const handleCancelFromTable = async (reqId: number | null) => {
    if (!reqId) return;
    setClosingReqId(reqId);
    try {
      await api.cancelRequest(reqId);
      await onRefresh();
    } finally {
      setClosingReqId(null);
    }
  };

  const handleCompleteAllPending = async () => {
    if (pendingItemsCount === 0) return;
    setClosingAll(true);
    try {
      await api.completeAllPendingRequests('Uygulama Paneli');
      await onRefresh();
    } finally {
      setClosingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Hızlı Referans Ekleme Paneli */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">
              Yeni Referans / Raf Etiketi Ekle
            </h2>
            <p className="text-xs text-slate-500">
              Tekli referans ekleyebilir veya Excel stok listenizi başlık
              eşleştirmeli olarak topluca içeri aktarabilirsiniz.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {items.length === 0 && (
              <button
                type="button"
                onClick={handleLoadDemo}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100"
              >
                <Sparkles className="h-4 w-4" />
                Örnek Referansları Yükle
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowBulkModal(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-extrabold text-emerald-800 shadow-2xs transition hover:bg-emerald-100"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              Excel Yükle / Başlık Seçerek Aktar
            </button>
          </div>
        </div>

        <form onSubmit={handleQuickCreate} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-3">
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Referans / Stok Kodu *
              </label>
              <input
                ref={refInputRef}
                type="text"
                value={newRef}
                onChange={(e) => setNewRef(e.target.value)}
                placeholder="Örn: KM-1042"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-bold uppercase placeholder:font-normal placeholder:normal-case focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none"
              />
            </div>

            <div className="md:col-span-5">
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Komponent Tanımı *
              </label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Örn: Ön Minder Yan Kanat Süngeri"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Raf / Göz (Ops.)
              </label>
              <input
                type="text"
                value={newShelf}
                onChange={(e) => setNewShelf(e.target.value)}
                placeholder="Örn: A-04"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Paket / Not (Ops.)
              </label>
              <input
                type="text"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                placeholder="Örn: Bağ 50 Ad."
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {/* Renkli Bölüm Seçim Butonları (Hiç seçilmezse bölümsüz eklenir) */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-600">
                Bölüm (Ops.):
              </span>
              {sections.map((sec) => {
                const isSelected = selectedFormSections.includes(sec.id);
                const fg = getContrastText(sec.color_hex);
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => toggleFormSection(sec.id)}
                    style={
                      isSelected
                        ? {
                            backgroundColor: sec.color_hex,
                            color: fg,
                            borderColor: sec.color_hex,
                          }
                        : {
                            borderColor: hexWithAlpha(sec.color_hex, '66'),
                            color: '#1E293B',
                            backgroundColor: hexWithAlpha(sec.color_hex, '10'),
                          }
                    }
                    className={`inline-flex items-center gap-2 rounded-xl border-2 px-3.5 py-1.5 text-xs font-extrabold transition ${
                      isSelected
                        ? 'scale-[1.02] shadow-sm'
                        : 'opacity-80 hover:opacity-100'
                    }`}
                  >
                    <span
                      style={{
                        backgroundColor: isSelected ? fg : sec.color_hex,
                      }}
                      className="h-2.5 w-2.5 rounded-full"
                    />
                    {sec.name}
                  </button>
                );
              })}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-extrabold text-white shadow-xs transition hover:bg-slate-800 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {saving ? 'Kaydediliyor...' : 'Referansı Kaydet'}
            </button>
          </div>

          {formError && (
            <div className="rounded-xl bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700 ring-1 ring-rose-200">
              {formError}
            </div>
          )}
        </form>
      </div>

      {/* Bölüm Filtre Sekmeleri + Arama + Seçili Etiket Aksiyon Barı */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Bölüm Filtreleri */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilterMode('ALL')}
              className={`rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
                filterMode === 'ALL'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              Tümü ({items.length})
            </button>

            {unassignedCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setFilterMode(
                    filterMode === 'UNASSIGNED' ? 'ALL' : 'UNASSIGNED'
                  )
                }
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
                  filterMode === 'UNASSIGNED'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-amber-50 text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100'
                }`}
              >
                ⏳ Bölüm Bekleyenler ({unassignedCount})
              </button>
            )}

            {sections.map((sec) => {
              const active = filterMode === sec.id;
              const count = items.filter((i) => i.section_id === sec.id).length;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setFilterMode(active ? 'ALL' : sec.id)}
                  style={
                    active
                      ? {
                          backgroundColor: sec.color_hex,
                          color: getContrastText(sec.color_hex),
                        }
                      : undefined
                  }
                  className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-extrabold transition ${
                    active
                      ? 'shadow-sm'
                      : 'bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span
                    style={{
                      backgroundColor: active
                        ? getContrastText(sec.color_hex)
                        : sec.color_hex,
                    }}
                    className="h-3 w-3 rounded-full"
                  />
                  {sec.name} ({count})
                </button>
              );
            })}
          </div>

          {/* Arama Kutusu + Bekleyenleri Toplu Kapat */}
          <div className="flex flex-wrap items-center gap-2">
            {pendingItemsCount > 0 && (
              <button
                type="button"
                disabled={closingAll}
                onClick={handleCompleteAllPending}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-extrabold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {closingAll
                  ? 'Kapatılıyor...'
                  : `Bekleyen ${pendingItemsCount} Talebi Kapat`}
              </button>
            )}

            <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Stok kodu, tanım veya raf ara..."
                className="w-full rounded-xl border border-slate-300 bg-white py-2 pr-8 pl-10 text-sm font-medium focus:border-blue-600 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Seçili Kayıtlar Yüzen İşlem Çubuğu (Toplu Bölüm Atama + Toplu Yazdırma + Silme) */}
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-blue-600 px-5 py-3 text-white shadow-md">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-lg bg-white/20 px-2.5 py-1 text-xs font-black">
                {selectedIds.length} Kayıt Seçildi
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-xs font-semibold text-blue-100 underline hover:text-white"
              >
                Seçimi Temizle
              </button>

              {/* Seçilenlere Tek Tıkla Toplu Bölüm Atama */}
              <div className="flex flex-wrap items-center gap-1 border-l border-white/25 pl-3">
                <span className="text-[11px] font-bold text-blue-100">
                  Toplu Bölüm Ata:
                </span>
                {sections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleBulkAssignSection(s.id)}
                    style={{
                      backgroundColor: s.color_hex,
                      color: getContrastText(s.color_hex),
                    }}
                    className="rounded-lg px-2 py-1 text-[11px] font-black uppercase shadow-2xs transition hover:scale-105"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBulkDelete}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-500/90 px-3.5 py-2 text-xs font-extrabold text-white transition hover:bg-rose-600"
              >
                <Trash2 className="h-4 w-4" />
                Sil
              </button>
              <button
                type="button"
                onClick={() => navigate('/yazdir')}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-blue-700 shadow-xs transition hover:bg-blue-50"
              >
                <Printer className="h-4 w-4" />
                Seçilen {selectedIds.length} Etiketi A4 Yazdır →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Referans Tablosu */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-extrabold tracking-wider text-slate-600 uppercase">
                <th className="w-12 px-4 py-3.5">
                  <button
                    type="button"
                    onClick={toggleSelectAllFiltered}
                    className="flex items-center text-slate-600 hover:text-slate-900"
                    title="Görünenlerin tümünü seç"
                  >
                    {allFilteredSelected ? (
                      <CheckSquare className="h-5 w-5 text-blue-600" />
                    ) : (
                      <Square className="h-5 w-5" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3.5">Bölüm / Renk (Tek Tıkla Seç)</th>
                <th className="px-4 py-3.5">Referans Kodu</th>
                <th className="px-4 py-3.5">Komponent Tanımı</th>
                <th className="px-4 py-3.5">Raf / Paket</th>
                <th className="px-4 py-3.5">Talep Durumu</th>
                <th className="px-4 py-3.5 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-12 text-center text-slate-500"
                  >
                    <p className="font-bold text-slate-700">
                      Gösterilecek referans kaydı bulunamadı.
                    </p>
                    <p className="mt-1 text-xs">
                      &quot;Excel Yükle / Başlık Seçerek Aktar&quot; butonuyla
                      tüm stok listenizi saniyeler içinde yükleyebilirsiniz.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const isChecked = selectedIds.includes(item.id);
                  const effSec = getEffectiveSection(item.section);
                  const secColor = item.section
                    ? effSec.color_hex
                    : '#CBD5E1';

                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderLeft: `6px solid ${secColor}`,
                      }}
                      className={`transition hover:bg-slate-50/90 ${
                        isChecked ? 'bg-blue-50/50' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleSelectOne(item.id)}
                          className="flex items-center text-slate-500 hover:text-slate-900"
                        >
                          {isChecked ? (
                            <CheckSquare className="h-5 w-5 text-blue-600" />
                          ) : (
                            <Square className="h-5 w-5" />
                          )}
                        </button>
                      </td>

                      {/* BÖLÜM / RENK: Atanmamışsa tek tık renkli butonlar, atanmışsa anında değiştirilebilir renkli rozet */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {item.section === null ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {sections.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                disabled={assigningItemId === item.id}
                                onClick={() =>
                                  handleInlineAssignSection(item.id, s.id)
                                }
                                style={{
                                  borderColor: s.color_hex,
                                  backgroundColor: hexWithAlpha(
                                    s.color_hex,
                                    '16'
                                  ),
                                }}
                                title={`${s.name} olarak ata`}
                                className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-extrabold text-slate-800 transition hover:scale-105 disabled:opacity-40"
                              >
                                <span
                                  style={{ backgroundColor: s.color_hex }}
                                  className="h-2 w-2 rounded-full"
                                />
                                {s.name}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <select
                            aria-label="Bölüm değiştir"
                            disabled={assigningItemId === item.id}
                            value={item.section_id ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              handleInlineAssignSection(
                                item.id,
                                val === '' ? null : Number(val)
                              );
                            }}
                            style={{
                              backgroundColor: effSec.color_hex,
                              color: getContrastText(effSec.color_hex),
                            }}
                            className="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-black tracking-wide uppercase shadow-2xs focus:outline-none"
                          >
                            {sections.map((s) => (
                              <option
                                key={s.id}
                                value={s.id}
                                className="bg-white font-bold text-slate-900"
                              >
                                {s.name}
                              </option>
                            ))}
                            <option
                              value=""
                              className="bg-white font-semibold text-slate-500"
                            >
                              — Bölüm Seçimini Kaldır —
                            </option>
                          </select>
                        )}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-base font-black text-slate-950">
                          {item.reference_code}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">
                          {item.description}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                        {item.shelf_code && (
                          <span className="mr-1.5 rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-700">
                            Raf: {item.shelf_code}
                          </span>
                        )}
                        {item.unit_info && (
                          <span className="text-slate-500">{item.unit_info}</span>
                        )}
                        {!item.shelf_code && !item.unit_info && (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        {item.has_pending_request ? (
                          <div className="inline-flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-extrabold text-amber-800">
                              <span className="h-2 w-2 animate-ping rounded-full bg-amber-500" />
                              Depoda Bekliyor (#{item.pending_request_id})
                            </span>

                            <button
                              type="button"
                              disabled={
                                closingReqId === item.pending_request_id
                              }
                              onClick={() =>
                                handleCloseFromTable(item.pending_request_id)
                              }
                              title="Talebi karşılandı olarak kapat (Rafa Konuldu)"
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-black text-white shadow-2xs transition hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Kapat
                            </button>

                            <button
                              type="button"
                              disabled={
                                closingReqId === item.pending_request_id
                              }
                              onClick={() =>
                                handleCancelFromTable(item.pending_request_id)
                              }
                              title="Talebi iptal et"
                              className="rounded-lg border border-slate-200 bg-white p-1 text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs font-medium text-emerald-700">
                            Rafta Mevcut
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handlePrintSingle(item)}
                            title="Bu etiketi yazdır"
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-blue-600 hover:text-white"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            Etiket
                          </button>

                          <a
                            href={`/t/${item.qr_token}`}
                            target="_blank"
                            rel="noreferrer"
                            title="QR okutma ekranını test et (Anında talep tetikler!)"
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-600 hover:text-white"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            QR Test
                          </a>

                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            title="Düzenle"
                            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteOne(item)}
                            title="Sil"
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Düzenleme Modalı */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-extrabold text-slate-900">
                Referans Düzenle
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Referans Kodu
                  </label>
                  <input
                    type="text"
                    required
                    value={editRef}
                    onChange={(e) => setEditRef(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold uppercase"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Bölüm
                  </label>
                  <select
                    value={editSectionId === null ? '' : editSectionId}
                    onChange={(e) =>
                      setEditSectionId(
                        e.target.value === '' ? null : Number(e.target.value)
                      )
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
                  >
                    <option value="">— Bölüm Seçilmedi —</option>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Komponent Tanımı
                </label>
                <input
                  type="text"
                  required
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Raf / Göz Kodu
                  </label>
                  <input
                    type="text"
                    value={editShelf}
                    onChange={(e) => setEditShelf(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Paket / Birim Bilgisi
                  </label>
                  <input
                    type="text"
                    value={editUnit}
                    onChange={(e) => setEditUnit(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-extrabold text-white hover:bg-blue-700"
                >
                  Değişiklikleri Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Akıllı Excel Dosyası & Başlık Eşleştirme Sihirbazı */}
      {showBulkModal && (
        <SmartExcelImportModal
          sections={sections}
          onClose={() => setShowBulkModal(false)}
          onImported={onRefresh}
        />
      )}

      {/* Tekli Referans Silme Onay Penceresi */}
      <ConfirmModal
        open={pendingDeleteItem !== null}
        title="Referansı Silmek İstediğinize Emin misiniz?"
        highlightText={
          pendingDeleteItem
            ? `${pendingDeleteItem.reference_code} — ${pendingDeleteItem.section?.name || 'Bölüm Seçilmedi'}`
            : undefined
        }
        description={
          pendingDeleteItem
            ? `"${pendingDeleteItem.description}" kaydı ve bu referansa ait QR etiket bağlantısı kalıcı olarak silinecektir. Bu işlem geri alınamaz.`
            : ''
        }
        confirmLabel="Evet, Referansı Sil"
        cancelLabel="Vazgeç"
        loading={deletingBusy}
        onConfirm={executeConfirmDeleteOne}
        onCancel={() => setPendingDeleteItem(null)}
      />

      {/* Toplu Referans Silme Onay Penceresi */}
      <ConfirmModal
        open={confirmingBulkDelete}
        title={`Seçili ${selectedIds.length} Referansı Silmek İstediğinize Emin misiniz?`}
        description={`İşaretlediğiniz toplam ${selectedIds.length} adet referans kaydı ve bunlara bağlı QR etiket bağlantıları kalıcı olarak silinecektir. Bu işlem geri alınamaz.`}
        confirmLabel={`Evet, ${selectedIds.length} Kaydı Sil`}
        cancelLabel="Vazgeç"
        loading={deletingBusy}
        onConfirm={executeConfirmBulkDelete}
        onCancel={() => setConfirmingBulkDelete(false)}
      />
    </div>
  );
}
