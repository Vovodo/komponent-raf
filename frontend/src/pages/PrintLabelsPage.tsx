import {
  Info,
  Layers,
  Maximize2,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  Scissors,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import {
  type LabelColorStyle,
  type LabelFontScale,
  type LabelLogoPlacement,
  ShelfLabelCard,
} from '../components/ShelfLabelCard';
import type { AppSettings, ComponentItem, Section } from '../types';
import { getContrastText } from '../utils/color';

type SizingMode = 'manual_mm' | 'smart_count';

interface SavedPrintPrefs {
  sizingMode: SizingMode;
  widthMm: number;
  heightMm: number;
  gapMm: number;
  marginMm: number;
  targetCountPerPage: number;
  smartColsOverride: number | null;
  colorStyle: LabelColorStyle;
  fontScale: LabelFontScale;
  logoPlacement: LabelLogoPlacement;
  showCutGuides: boolean;
}

const STORAGE_KEY = 'komponent_raf_print_prefs_v2';

const DEFAULT_PREFS: SavedPrintPrefs = {
  sizingMode: 'manual_mm',
  widthMm: 97,
  heightMm: 57, // Önceki 68 mm'den ~1.1 cm kısaltıldı -> A4'e 2x5 = 10 etiket tam sığar!
  gapMm: 1.5,
  marginMm: 3,
  targetCountPerPage: 10,
  smartColsOverride: null,
  colorStyle: 'band',
  fontScale: 'normal',
  logoPlacement: 'header_badge',
  showCutGuides: true,
};

const SMART_COUNT_SHORTCUTS = [4, 6, 8, 10, 12, 14, 16, 18, 21, 24, 30];

/**
 * Hedef etiket sayısını A4 kağıdına en ergonomik raf etiketi oranıyla (~1.6 - 2.3 yatay dikdörtgen)
 * sığdıran en iyi (sütun x satır) kombinasyonunu ve milimetrik etiket boyutunu hesaplar.
 */
function computeSmartGrid(
  targetCount: number,
  marginMm: number,
  gapMm: number,
  colsOverride: number | null
): {
  cols: number;
  rows: number;
  widthMm: number;
  heightMm: number;
  capacity: number;
} {
  const safeTarget = Math.max(1, Math.min(60, Math.round(targetCount || 10)));
  const availW = 210 - marginMm * 2;
  const availH = 297 - marginMm * 2;

  if (colsOverride && colsOverride >= 1 && colsOverride <= 6) {
    const cols = colsOverride;
    const rows = Math.max(1, Math.ceil(safeTarget / cols));
    const widthMm = +((availW - (cols - 1) * gapMm) / cols).toFixed(1);
    const heightMm = +((availH - (rows - 1) * gapMm) / rows).toFixed(1);
    return {
      cols,
      rows,
      widthMm: Math.max(32, widthMm),
      heightMm: Math.max(20, heightMm),
      capacity: cols * rows,
    };
  }

  let best = { cols: 2, rows: 5, score: Infinity };

  for (let cols = 1; cols <= 5; cols++) {
    const rows = Math.max(1, Math.ceil(safeTarget / cols));
    const capacity = cols * rows;
    const w = (availW - (cols - 1) * gapMm) / cols;
    const h = (availH - (rows - 1) * gapMm) / rows;
    if (w < 38 || h < 22) continue;

    const aspect = w / h;
    // Raf etiketleri için ideal yatay oran ~1.72 (örn. 97x56mm = 1.73)
    const aspectPenalty = Math.abs(Math.log(aspect / 1.72)) * 12;
    // Boş kalan hücre cezası (mümkünse tam bölünen ızgaraları tercih et: 10->2x5, 12->2x6, 21->3x7)
    const wasteCells = capacity - safeTarget;
    const wastePenalty = wasteCells * 4.5;

    const totalScore = aspectPenalty + wastePenalty;
    if (totalScore < best.score) {
      best = { cols, rows, score: totalScore };
    }
  }

  const widthMm = +(
    (availW - (best.cols - 1) * gapMm) /
    best.cols
  ).toFixed(1);
  const heightMm = +(
    (availH - (best.rows - 1) * gapMm) /
    best.rows
  ).toFixed(1);

  return {
    cols: best.cols,
    rows: best.rows,
    widthMm,
    heightMm,
    capacity: best.cols * best.rows,
  };
}

function loadSavedPrefs(): SavedPrintPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface PrintLabelsPageProps {
  sections: Section[];
  items: ComponentItem[];
  selectedIds: number[];
  setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>;
  settings: AppSettings | null;
}

export function PrintLabelsPage({
  sections,
  items,
  selectedIds,
  setSelectedIds,
  settings,
}: PrintLabelsPageProps) {
  const [prefs, setPrefs] = useState<SavedPrintPrefs>(loadSavedPrefs);
  const [copiesPerItem, setCopiesPerItem] = useState<number>(1);
  const [liveLogoScale, setLiveLogoScale] = useState<number>(
    settings?.company_logo_scale ?? 100
  );
  const scaleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [quickSectionFilter, setQuickSectionFilter] = useState<
    'selected' | 'all' | number
  >(() => (selectedIds.length > 0 ? 'selected' : 'all'));

  useEffect(() => {
    if (settings?.company_logo_scale) {
      setLiveLogoScale(settings.company_logo_scale);
    }
  }, [settings?.company_logo_scale]);

  const handlePrintLogoScaleChange = (val: number) => {
    const clamped = Math.max(40, Math.min(240, Math.round(val)));
    setLiveLogoScale(clamped);
    if (scaleDebounceRef.current) clearTimeout(scaleDebounceRef.current);
    scaleDebounceRef.current = setTimeout(() => {
      api.updateCompanyLogoScale(clamped).catch(() => {});
    }, 220);
  };

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // ignore storage quota
    }
  }, [prefs]);

  const updatePref = <K extends keyof SavedPrintPrefs>(
    key: K,
    value: SavedPrintPrefs[K]
  ) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  };

  const itemsToPrint = useMemo(() => {
    let baseList: ComponentItem[] = [];
    if (quickSectionFilter === 'selected') {
      baseList = items.filter((i) => selectedIds.includes(i.id));
    } else if (quickSectionFilter === 'all') {
      baseList = items;
    } else {
      baseList = items.filter((i) => i.section_id === quickSectionFilter);
    }

    const expanded: ComponentItem[] = [];
    const copies = Math.max(1, Math.min(20, copiesPerItem));
    for (const item of baseList) {
      for (let c = 0; c < copies; c++) {
        expanded.push(item);
      }
    }
    return expanded;
  }, [items, selectedIds, quickSectionFilter, copiesPerItem]);

  // Aktif A4 Sayfa Yerleşimi Hesabı (Manuel mm VEYA Akıllı Adet Sığdırma)
  const activeLayout = useMemo(() => {
    const gap = Math.max(0, Math.min(10, prefs.gapMm));
    const margin = Math.max(2, Math.min(15, prefs.marginMm));
    const availW = 210 - margin * 2;
    const availH = 297 - margin * 2;

    if (prefs.sizingMode === 'smart_count') {
      const smart = computeSmartGrid(
        prefs.targetCountPerPage,
        margin,
        gap,
        prefs.smartColsOverride
      );
      return {
        cols: smart.cols,
        rows: smart.rows,
        widthMm: smart.widthMm,
        heightMm: smart.heightMm,
        gapMm: gap,
        marginMm: margin,
      };
    }

    // Manuel mm modu
    const w = Math.max(35, Math.min(availW, prefs.widthMm || 97));
    const h = Math.max(20, Math.min(availH, prefs.heightMm || 57));
    const cols = Math.max(1, Math.floor((availW + gap + 0.01) / (w + gap)));
    const rows = Math.max(1, Math.floor((availH + gap + 0.01) / (h + gap)));

    return {
      cols,
      rows,
      widthMm: w,
      heightMm: h,
      gapMm: gap,
      marginMm: margin,
    };
  }, [prefs]);

  const perPage = activeLayout.cols * activeLayout.rows;
  const paperUsagePct = Math.min(
    99,
    Math.round(
      ((perPage * activeLayout.widthMm * activeLayout.heightMm) /
        (210 * 297)) *
        100
    )
  );

  const pages = useMemo(() => {
    const chunks: ComponentItem[][] = [];
    for (let i = 0; i < itemsToPrint.length; i += perPage) {
      chunks.push(itemsToPrint.slice(i, i + perPage));
    }
    return chunks;
  }, [itemsToPrint, perPage]);

  const baseUrl = settings?.public_base_url || window.location.origin;
  const logoUrl = settings?.company_logo_data_url || null;

  const handleFitAllIntoSinglePage = () => {
    if (itemsToPrint.length === 0) return;
    setPrefs((prev) => ({
      ...prev,
      sizingMode: 'smart_count',
      targetCountPerPage: Math.min(48, itemsToPrint.length),
      smartColsOverride: null,
    }));
  };

  return (
    <div className="print-root space-y-6">
      {/* Yazdırma Kontrol Paneli (Yazıcıdan çıkarken gizlenir) */}
      <div className="no-print rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        {/* Üst Başlık ve Yazdır Butonu */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-black text-slate-900">
              A4 Renkli Raf Etiketi Yazdırma &amp; Akıllı Boyutlandırma
            </h2>
            <p className="text-xs text-slate-500">
              Toplam <strong>{itemsToPrint.length} etiket</strong> •{' '}
              <strong>{pages.length} adet A4 sayfa</strong> • A4 başına{' '}
              <strong>
                {perPage} etiket ({activeLayout.cols}×{activeLayout.rows})
              </strong>{' '}
              • Etiket Ölçüsü:{' '}
              <strong className="text-blue-700">
                {activeLayout.widthMm} × {activeLayout.heightMm} mm
              </strong>{' '}
              (Kağıt verimi %{paperUsagePct})
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPrefs(DEFAULT_PREFS)}
              title="Varsayılan 97x57 mm ölçüsüne sıfırla"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Sıfırla (97×57mm)
            </button>

            <button
              type="button"
              disabled={itemsToPrint.length === 0}
              onClick={() => window.print()}
              className="inline-flex items-center gap-2.5 rounded-2xl bg-blue-600 px-6 py-3 text-sm font-black text-white shadow-md transition hover:bg-blue-700 disabled:opacity-40"
            >
              <Printer className="h-5 w-5" />
              A4 YAZICIDAN ÇIKTI AL ({pages.length} Sayfa)
            </button>
          </div>
        </div>

        {/* Hangi Etiketler Basılacak? */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-extrabold text-slate-600">
            Yazdırılacak Etiket Grubu:
          </span>

          <button
            type="button"
            onClick={() => setQuickSectionFilter('selected')}
            className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${
              quickSectionFilter === 'selected'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Tablodan Seçilenler ({selectedIds.length})
          </button>

          <button
            type="button"
            onClick={() => setQuickSectionFilter('all')}
            className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${
              quickSectionFilter === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Tüm Referanslar ({items.length})
          </button>

          {sections.map((sec) => {
            const count = items.filter((i) => i.section_id === sec.id).length;
            const active = quickSectionFilter === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => {
                  setQuickSectionFilter(sec.id);
                  setSelectedIds(
                    items
                      .filter((i) => i.section_id === sec.id)
                      .map((i) => i.id)
                  );
                }}
                style={
                  active
                    ? {
                        backgroundColor: sec.color_hex,
                        color: getContrastText(sec.color_hex),
                      }
                    : undefined
                }
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${
                  active
                    ? 'shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
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
                Sadece {sec.name} ({count})
              </button>
            );
          })}
        </div>

        {/* Boyutlandırma Modu Seçici: Manuel Milimetre vs Akıllı A4 Sığdırma */}
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl bg-slate-200/80 p-1">
              <button
                type="button"
                onClick={() => updatePref('sizingMode', 'manual_mm')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-extrabold transition ${
                  prefs.sizingMode === 'manual_mm'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Sliders className="h-3.5 w-3.5 text-blue-600" />
                Manuel Boyut Ayarla (mm)
              </button>

              <button
                type="button"
                onClick={() => updatePref('sizingMode', 'smart_count')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-extrabold transition ${
                  prefs.sizingMode === 'smart_count'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                Akıllı A4 Sığdırma (Adet Seç)
              </button>
            </div>

            {itemsToPrint.length > 0 && itemsToPrint.length <= 40 && (
              <button
                type="button"
                onClick={handleFitAllIntoSinglePage}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-extrabold text-indigo-700 transition hover:bg-indigo-100"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                Listedeki {itemsToPrint.length} Etiketi Tek A4&apos;e Sığdır
              </button>
            )}
          </div>

          {/* MOD 1: Manuel mm Ayarlama */}
          {prefs.sizingMode === 'manual_mm' ? (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-12">
              {/* Genişlik mm */}
              <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 md:col-span-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-extrabold text-slate-700">
                    Etiket Genişliği (mm)
                  </label>
                  <span className="font-mono text-xs font-black text-blue-700">
                    {(prefs.widthMm / 10).toFixed(1)} cm
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updatePref('widthMm', Math.max(40, prefs.widthMm - 1))
                    }
                    className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="range"
                    min={45}
                    max={198}
                    step={1}
                    value={prefs.widthMm}
                    onChange={(e) =>
                      updatePref('widthMm', Number(e.target.value))
                    }
                    className="h-2 flex-1 cursor-pointer accent-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updatePref('widthMm', Math.min(198, prefs.widthMm + 1))
                    }
                    className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="number"
                    min={40}
                    max={198}
                    value={prefs.widthMm}
                    onChange={(e) =>
                      updatePref('widthMm', Number(e.target.value) || 97)
                    }
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center font-mono text-sm font-black"
                  />
                </div>
              </div>

              {/* Yükseklik mm */}
              <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 md:col-span-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-extrabold text-slate-700">
                    Etiket Yüksekliği / Uzunluğu (mm)
                  </label>
                  <span className="font-mono text-xs font-black text-blue-700">
                    {(prefs.heightMm / 10).toFixed(1)} cm
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updatePref('heightMm', Math.max(24, prefs.heightMm - 1))
                    }
                    className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="range"
                    min={25}
                    max={140}
                    step={1}
                    value={prefs.heightMm}
                    onChange={(e) =>
                      updatePref('heightMm', Number(e.target.value))
                    }
                    className="h-2 flex-1 cursor-pointer accent-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updatePref('heightMm', Math.min(140, prefs.heightMm + 1))
                    }
                    className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="number"
                    min={24}
                    max={280}
                    value={prefs.heightMm}
                    onChange={(e) =>
                      updatePref('heightMm', Number(e.target.value) || 57)
                    }
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center font-mono text-sm font-black"
                  />
                </div>
              </div>

              {/* Hazır Ölçü Kısayolları + Boşluk */}
              <div className="flex flex-col justify-between rounded-xl bg-white p-3 ring-1 ring-slate-200 md:col-span-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-slate-700">
                    Hızlı Ölçüler:
                  </span>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="font-semibold text-slate-500">Aralık:</span>
                    <input
                      type="number"
                      min={0}
                      max={8}
                      step={0.5}
                      value={prefs.gapMm}
                      onChange={(e) =>
                        updatePref('gapMm', Number(e.target.value))
                      }
                      className="w-13 rounded border border-slate-300 px-1.5 py-0.5 text-center font-mono font-bold"
                    />
                    <span className="text-slate-500">mm</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    { label: '97×57 (10/A4)', w: 97, h: 57 },
                    { label: '97×58 (8/A4)', w: 97, h: 58 },
                    { label: '97×46 (12/A4)', w: 97, h: 46 },
                    { label: '64×39 (21/A4)', w: 64, h: 39 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        updatePref('widthMm', preset.w);
                        updatePref('heightMm', preset.h);
                      }}
                      className={`rounded-lg px-2 py-1 text-[11px] font-extrabold transition ${
                        prefs.widthMm === preset.w &&
                        prefs.heightMm === preset.h
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* MOD 2: Akıllı A4 Sığdırma */
            <div className="mt-4 grid grid-cols-1 items-center gap-4 md:grid-cols-12">
              <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200 md:col-span-7">
                <label className="block text-xs font-extrabold text-slate-700">
                  1 A4 Sayfaya Kaç Adet Etiket Sığdırılsın?
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {SMART_COUNT_SHORTCUTS.map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => {
                        updatePref('targetCountPerPage', cnt);
                        updatePref('smartColsOverride', null);
                      }}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-black transition ${
                        prefs.targetCountPerPage === cnt
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {cnt}
                    </button>
                  ))}

                  <div className="ml-1 flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-500">
                      Özel:
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={prefs.targetCountPerPage}
                      onChange={(e) => {
                        updatePref(
                          'targetCountPerPage',
                          Math.max(1, Number(e.target.value) || 1)
                        );
                        updatePref('smartColsOverride', null);
                      }}
                      className="w-16 rounded-lg border border-indigo-300 px-2 py-1 text-center font-mono text-sm font-black text-indigo-900"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200 md:col-span-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-700">
                    Sütun Düzeni:
                  </span>
                  <div className="flex gap-1">
                    {[null, 1, 2, 3, 4].map((colOpt) => (
                      <button
                        key={String(colOpt)}
                        type="button"
                        onClick={() => updatePref('smartColsOverride', colOpt)}
                        className={`rounded-md px-2 py-1 text-[11px] font-extrabold ${
                          prefs.smartColsOverride === colOpt
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {colOpt === null ? 'Otomatik' : `${colOpt} Sütun`}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-2.5 text-xs font-semibold text-slate-600">
                  Hesaplanan Otomatik Ölçü:{' '}
                  <strong className="text-indigo-700">
                    {activeLayout.cols} Sütun × {activeLayout.rows} Satır (
                    {activeLayout.widthMm} × {activeLayout.heightMm} mm)
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Görünüm, Logo Konumu, Logo Boyutu, Punto ve Kopya Ayarları */}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-3">
            <label className="mb-1 block text-xs font-bold text-slate-700">
              Bölüm Rengi Görünümü
            </label>
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => updatePref('colorStyle', 'band')}
                className={`rounded-lg px-2 py-2 text-xs font-extrabold transition ${
                  prefs.colorStyle === 'band'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600'
                }`}
              >
                Şerit &amp; Çerçeve
              </button>
              <button
                type="button"
                onClick={() => updatePref('colorStyle', 'full')}
                className={`rounded-lg px-2 py-2 text-xs font-extrabold transition ${
                  prefs.colorStyle === 'full'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600'
                }`}
              >
                Tam Renkli
              </button>
            </div>
          </div>

          <div className="md:col-span-3">
            <label className="mb-1 block text-xs font-bold text-slate-700">
              Şirket Logosu Konumu
            </label>
            <select
              value={prefs.logoPlacement}
              onChange={(e) =>
                updatePref(
                  'logoPlacement',
                  e.target.value as LabelLogoPlacement
                )
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold"
            >
              <option value="header_badge">
                Üst Şeritte Doğrudan Şeffaf (Önerilen)
              </option>
              <option value="qr_center">Üst Şeritte + QR Kod Ortasında</option>
              <option value="footer_brand">Sol Alt Köşede Şeffaf</option>
              <option value="hidden">Etikette Logoyu Gizle</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 flex items-center justify-between text-xs font-bold text-slate-700">
              <span>Logo Boyutu</span>
              <span className="font-mono text-indigo-700">
                %{liveLogoScale}
              </span>
            </label>
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2.5 py-2">
              <input
                type="range"
                min={40}
                max={240}
                step={5}
                value={liveLogoScale}
                onChange={(e) =>
                  handlePrintLogoScaleChange(Number(e.target.value))
                }
                className="h-1.5 w-full cursor-pointer accent-indigo-600"
              />
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-bold text-slate-700">
              Referans Punto
            </label>
            <select
              value={prefs.fontScale}
              onChange={(e) =>
                updatePref('fontScale', e.target.value as LabelFontScale)
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-bold"
            >
              <option value="normal">Otomatik</option>
              <option value="large">Büyük (+%11)</option>
              <option value="xlarge">Çok Büyük (+%22)</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-bold text-slate-700">
              Kopya &amp; Kesim Çizgisi
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={10}
                value={copiesPerItem}
                onChange={(e) =>
                  setCopiesPerItem(Math.max(1, Number(e.target.value) || 1))
                }
                className="w-16 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-center text-sm font-bold"
              />
              <button
                type="button"
                onClick={() =>
                  updatePref('showCutGuides', !prefs.showCutGuides)
                }
                title="Kesim kılavuz çizgilerini aç/kapat"
                className={`inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-bold ${
                  prefs.showCutGuides
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-300 bg-white text-slate-500'
                }`}
              >
                <Scissors className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Yazıcı İpucu */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sky-50 px-4 py-2.5 text-xs text-sky-900 ring-1 ring-sky-200">
          <span className="flex items-center gap-2 font-medium">
            <Info className="h-4 w-4 shrink-0 text-sky-600" />
            <span>
              <strong>Yazdırma İpucu:</strong> Yazıcı penceresinde{' '}
              <strong>Arka Plan Grafikleri: Açık</strong> ve{' '}
              <strong>Ölçek: %100</strong> seçtiğinizde bölüm renkleri, şirket
              logonuz ve milimetrik ölçüler birebir çıkar.
            </span>
          </span>
          {!logoUrl && (
            <span className="font-bold text-indigo-700">
              İpucu: Bölüm &amp; Telegram sekmesinden şirket PNG logonuzu
              yükleyebilirsiniz.
            </span>
          )}
        </div>
      </div>

      {/* A4 Gerçek Boyutlu Önizleme / Yazdırma Alanı */}
      {pages.length === 0 ? (
        <div className="no-print rounded-2xl border border-dashed border-slate-300 bg-white p-14 text-center">
          <Layers className="mx-auto h-10 w-10 text-slate-400" />
          <h3 className="mt-3 text-base font-extrabold text-slate-800">
            Yazdırılacak Etiket Seçilmedi
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Yukarıdan &quot;Tüm Referanslar&quot; veya istediğiniz bölümü
            seçebilir ya da Referans Tablosu&apos;ndan etiket
            işaretleyebilirsiniz.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-8 pb-12">
          {pages.map((pageItems, pageIdx) => (
            <div key={pageIdx} className="flex flex-col items-center">
              <div className="no-print mb-2 text-xs font-bold text-slate-500">
                A4 Sayfa {pageIdx + 1} / {pages.length} ({activeLayout.cols}×
                {activeLayout.rows} • {activeLayout.widthMm}×
                {activeLayout.heightMm} mm)
              </div>

              <div
                style={{
                  width: '210mm',
                  height: '297mm',
                  padding: `${activeLayout.marginMm}mm`,
                }}
                className="a4-sheet box-border flex items-center justify-center border border-slate-300 bg-white shadow-xl"
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${activeLayout.cols}, ${activeLayout.widthMm}mm)`,
                    gridTemplateRows: `repeat(${activeLayout.rows}, ${activeLayout.heightMm}mm)`,
                    gap: `${activeLayout.gapMm}mm`,
                  }}
                >
                  {pageItems.map((item, idx) => (
                    <ShelfLabelCard
                      key={`${item.id}-${idx}`}
                      item={item}
                      baseUrl={baseUrl}
                      logoUrl={logoUrl}
                      logoScale={liveLogoScale}
                      logoPlacement={prefs.logoPlacement}
                      widthMm={activeLayout.widthMm}
                      heightMm={activeLayout.heightMm}
                      colorStyle={prefs.colorStyle}
                      fontScale={prefs.fontScale}
                      showCutGuides={prefs.showCutGuides}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
