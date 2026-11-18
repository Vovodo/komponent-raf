import {
  CheckCircle2,
  ClipboardPaste,
  FileSpreadsheet,
  Table2,
  Upload,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api';
import type { BulkImportRow, Section } from '../types';

interface SmartExcelImportModalProps {
  sections: Section[];
  onClose: () => void;
  onImported: () => Promise<void>;
}

function normalizeTR(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function excelColLetter(idx: number): string {
  let n = idx;
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/**
 * İlk 15 satırı tarayarak gerçek sütun başlıklarının (Stok Kodu, Tanımı, Miktarı vb.)
 * bulunduğu satırı otomatik tespit eder.
 */
function detectBestHeaderRow(matrix: string[][]): number {
  const headerKeywords = [
    'stok',
    'kod',
    'referans',
    'ref',
    'tanim',
    'malzeme',
    'urun',
    'aciklama',
    'ad',
    'isim',
    'miktar',
    'birim',
    'raf',
    'bolum',
  ];

  let bestRow = 0;
  let bestScore = -1;
  const limit = Math.min(15, matrix.length);

  for (let r = 0; r < limit; r++) {
    const row = matrix[r] || [];
    const nonEmpty = row.filter((c) => c.trim().length > 0);
    if (nonEmpty.length < 2) continue;

    let score = nonEmpty.length * 2;
    for (const cell of nonEmpty) {
      const norm = normalizeTR(cell);
      for (const kw of headerKeywords) {
        if (norm === kw || norm.includes(kw)) {
          score += 10;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  return bestRow;
}

function autoGuessColumns(headers: string[]) {
  let refCol = -1;
  let descCol = -1;
  let shelfCol = -1;
  let sectionCol = -1;

  headers.forEach((h, idx) => {
    const norm = normalizeTR(h);
    if (!norm) return;

    if (
      refCol === -1 &&
      (norm.includes('stok kod') ||
        norm.includes('referans') ||
        norm.includes('malzeme kod') ||
        norm.includes('urun kod') ||
        norm.includes('parca kod') ||
        norm === 'kod' ||
        norm === 'kodu' ||
        norm === 'ref' ||
        norm === 'stok no')
    ) {
      refCol = idx;
      return;
    }

    if (
      descCol === -1 &&
      (norm.includes('tanim') ||
        norm.includes('stok ad') ||
        norm.includes('malzeme ad') ||
        norm.includes('urun ad') ||
        norm.includes('aciklama') ||
        norm.includes('cins') ||
        norm === 'ad' ||
        norm === 'adi' ||
        norm === 'isim')
    ) {
      descCol = idx;
      return;
    }

    if (
      shelfCol === -1 &&
      (norm.includes('raf') || norm.includes('goz') || norm.includes('lokasyon'))
    ) {
      shelfCol = idx;
      return;
    }

    if (sectionCol === -1 && norm.includes('bolum')) {
      sectionCol = idx;
    }
  });

  // Eğer anahtar kelimeyle bulunamadıysa ilk 2 dolu sütunu varsayılan seç
  if (refCol === -1 && headers.length >= 1) refCol = 0;
  if (descCol === -1 && headers.length >= 2) {
    descCol = refCol === 0 ? 1 : 0;
  }

  return {
    refCol,
    descCol,
    shelfCol,
    unitCol: -1, // Miktar/Birim bilgisini kullanıcı özellikle seçmedikçe otomatik alma!
    sectionCol,
  };
}

function parsePastedTextToMatrix(raw: string): string[][] {
  const lines = raw
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const usesTab = lines.some((l) => l.includes('\t'));
  const delimiter = usesTab ? '\t' : lines[0].includes(';') ? ';' : ',';

  return lines.map((line) =>
    line.split(delimiter).map((cell) => cell.replace(/^"|"$/g, '').trim())
  );
}

export function SmartExcelImportModal({
  sections,
  onClose,
  onImported,
}: SmartExcelImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sourceTab, setSourceTab] = useState<'file' | 'paste'>('file');
  const [fileName, setFileName] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [pastedText, setPastedText] = useState<string>('');

  const [rawMatrix, setRawMatrix] = useState<string[][]>([]);
  const [headerRowIdx, setHeaderRowIdx] = useState<number>(0);

  // Eşleştirilen sütun indeksleri (-1 = Bu alanı alma)
  const [refCol, setRefCol] = useState<number>(-1);
  const [descCol, setDescCol] = useState<number>(-1);
  const [shelfCol, setShelfCol] = useState<number>(-1);
  const [unitCol, setUnitCol] = useState<number>(-1);
  const [sectionCol, setSectionCol] = useState<number>(-1);

  // Varsayılan bölüm: null = "Bölüm Atanmamış (Sonra Tablodan Tek Tek Kendim Seçeceğim)"
  const [targetSectionId, setTargetSectionId] = useState<number | null>(null);

  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
  } | null>(null);

  const applyNewMatrix = (matrix: string[][]) => {
    setRawMatrix(matrix);
    setFeedback(null);
    if (matrix.length === 0) return;

    const detectedHeader = detectBestHeaderRow(matrix);
    setHeaderRowIdx(detectedHeader);

    const headers = (matrix[detectedHeader] || []).map((c) => String(c || '').trim());
    const guessed = autoGuessColumns(headers);
    setRefCol(guessed.refCol);
    setDescCol(guessed.descCol);
    setShelfCol(guessed.shelfCol);
    setUnitCol(guessed.unitCol);
    setSectionCol(guessed.sectionCol);
  };

  const loadSheetFromWorkbook = (wb: XLSX.WorkBook, sheetName: string) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;
    const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    const strMatrix = aoa.map((row) =>
      row.map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim()))
    );
    applyNewMatrix(strMatrix);
  };

  const handleExcelFile = async (file: File | undefined) => {
    if (!file) return;
    setFeedback(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      setFileName(file.name);
      setWorkbook(wb);
      setSheetNames(wb.SheetNames);
      const firstSheet = wb.SheetNames[0] || '';
      setActiveSheet(firstSheet);
      if (firstSheet) {
        loadSheetFromWorkbook(wb, firstSheet);
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: `Excel dosyası okunamadı: ${(err as Error).message}`,
      });
    }
  };

  const handleHeaderRowChange = (newIdx: number) => {
    setHeaderRowIdx(newIdx);
    const headers = (rawMatrix[newIdx] || []).map((c) => String(c || '').trim());
    const guessed = autoGuessColumns(headers);
    setRefCol(guessed.refCol);
    setDescCol(guessed.descCol);
    setShelfCol(guessed.shelfCol);
    setUnitCol(guessed.unitCol);
    setSectionCol(guessed.sectionCol);
  };

  const handleParsePaste = (txt: string) => {
    setPastedText(txt);
    const mat = parsePastedTextToMatrix(txt);
    applyNewMatrix(mat);
  };

  // Seçilen başlık satırındaki sütun isimleri
  const columnOptions = useMemo(() => {
    if (rawMatrix.length === 0) return [];
    const maxCols = rawMatrix.reduce((acc, r) => Math.max(acc, r.length), 0);
    const hdrRow = rawMatrix[headerRowIdx] || [];
    const cols: { idx: number; label: string; sample: string }[] = [];

    const sampleDataRow = rawMatrix[headerRowIdx + 1] || [];
    for (let c = 0; c < maxCols; c++) {
      const rawTitle = (hdrRow[c] || '').trim();
      const sampleVal = (sampleDataRow[c] || '').trim();
      const letter = excelColLetter(c);
      const label = rawTitle
        ? `[${letter}] ${rawTitle}`
        : `[${letter}] (Başlıksız Sütun)`;
      cols.push({ idx: c, label, sample: sampleVal });
    }
    return cols;
  }, [rawMatrix, headerRowIdx]);

  // Eşleştirmeye göre çıkarılan tüm geçerli satırlar
  const mappedRows = useMemo<BulkImportRow[]>(() => {
    if (rawMatrix.length <= headerRowIdx + 1 || refCol < 0 || descCol < 0) {
      return [];
    }
    const result: BulkImportRow[] = [];
    for (let r = headerRowIdx + 1; r < rawMatrix.length; r++) {
      const row = rawMatrix[r] || [];
      const refVal = (row[refCol] || '').trim();
      const descVal = (row[descCol] || '').trim();
      if (!refVal || !descVal) continue;

      result.push({
        reference_code: refVal,
        description: descVal,
        shelf_code: shelfCol >= 0 ? (row[shelfCol] || '').trim() || undefined : undefined,
        unit_info: unitCol >= 0 ? (row[unitCol] || '').trim() || undefined : undefined,
        section_name:
          sectionCol >= 0 ? (row[sectionCol] || '').trim() || undefined : undefined,
      });
    }
    return result;
  }, [rawMatrix, headerRowIdx, refCol, descCol, shelfCol, unitCol, sectionCol]);

  const handleImportSubmit = async () => {
    if (mappedRows.length === 0) {
      setFeedback({
        type: 'err',
        msg: 'Aktarılacak geçerli satır bulunamadı. Lütfen Stok Kodu ve Tanım sütunlarını kontrol edin.',
      });
      return;
    }

    setImporting(true);
    setFeedback(null);
    try {
      const res = await api.bulkImportItems(targetSectionId, mappedRows);
      await onImported();
      setFeedback({
        type: 'ok',
        msg: `Tamamlandı! ${res.created_count} yeni stok kodu eklendi, ${res.updated_count} mevcut kayıt güncellendi.`,
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-5">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* Üst Başlık */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 sm:text-lg">
                Akıllı Excel Yükleme &amp; Üst Başlık Eşleştirme Sihirbazı
              </h3>
              <p className="text-xs text-slate-500">
                Excel dosyanızı yükleyin veya yapıştırın; sistem üst başlıkları
                bulur, istediğiniz sütunları seçip aktarırsınız.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Kaydırılabilir İçerik */}
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {/* Kaynak Seçimi: Dosya Yükle vs Yapıştır */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setSourceTab('file')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-extrabold transition ${
                  sourceTab === 'file'
                    ? 'bg-white text-slate-950 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Upload className="h-3.5 w-3.5 text-emerald-600" />
                Excel Dosyası Seç (.xlsx / .xls / .csv)
              </button>

              <button
                type="button"
                onClick={() => setSourceTab('paste')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-extrabold transition ${
                  sourceTab === 'paste'
                    ? 'bg-white text-slate-950 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ClipboardPaste className="h-3.5 w-3.5 text-blue-600" />
                Excel&apos;den Kopyala &amp; Yapıştır
              </button>
            </div>

            {workbook && sheetNames.length > 1 && sourceTab === 'file' && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600">
                  Excel Sayfası:
                </span>
                <select
                  value={activeSheet}
                  onChange={(e) => {
                    setActiveSheet(e.target.value);
                    loadSheetFromWorkbook(workbook, e.target.value);
                  }}
                  className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold"
                >
                  {sheetNames.map((sn) => (
                    <option key={sn} value={sn}>
                      {sn}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Giriş Alanı */}
          {sourceTab === 'file' ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => handleExcelFile(e.target.files?.[0])}
                className="hidden"
              />
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleExcelFile(e.dataTransfer.files?.[0]);
                }}
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 px-6 py-6 text-center transition hover:border-emerald-500 hover:bg-emerald-50/80"
              >
                <FileSpreadsheet className="h-9 w-9 text-emerald-600" />
                {fileName ? (
                  <>
                    <p className="mt-2 text-sm font-black text-emerald-900">
                      Yüklendi: {fileName}{' '}
                      <span className="font-semibold text-emerald-700">
                        ({rawMatrix.length} satır okundu)
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-700 underline">
                      Başka bir Excel dosyası seçmek için tıklayın
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-sm font-extrabold text-slate-800">
                      Stok Listesi Excel Dosyanızı Buraya Sürükleyin veya Seçin
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      İçinde Stok Kodu, Tanımı, Miktarı vb. ne kadar sütun
                      olursa olsun üst başlıklar otomatik taranır.
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div>
              <textarea
                rows={4}
                value={pastedText}
                onChange={(e) => handleParsePaste(e.target.value)}
                placeholder={
                  'Excel tablonuzdan üst başlık satırıyla birlikte kopyalayıp buraya yapıştırın:\nStok Kodu\tStok Tanımı\tMiktarı\tBirim\nKM-1042\tÖn Minder Yan Sünger\t250\tAdet'
                }
                className="w-full rounded-2xl border border-slate-300 p-3.5 font-mono text-xs focus:border-blue-600 focus:outline-none"
              />
            </div>
          )}

          {/* Sütun Eşleştirme & Başlık Seçimi (Veri yüklendiğinde açılır) */}
          {rawMatrix.length > 0 && (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <div>
                  <h4 className="text-sm font-black text-slate-900">
                    1. Hangi Üst Başlıklar Alınsın?
                  </h4>
                  <p className="text-xs text-slate-500">
                    Excel&apos;inizdeki{' '}
                    <strong>{columnOptions.length} adet sütun başlığı</strong>{' '}
                    tarandı. Almak istemediğiniz sütunları (ör. Miktar, Tutar)
                    boş bırakabilirsiniz.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-600">
                    Üst Başlık Satırı:
                  </span>
                  <select
                    value={headerRowIdx}
                    onChange={(e) =>
                      handleHeaderRowChange(Number(e.target.value))
                    }
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold"
                  >
                    {rawMatrix.slice(0, 15).map((r, idx) => {
                      const preview = r
                        .filter(Boolean)
                        .slice(0, 3)
                        .join(' | ')
                        .slice(0, 42);
                      return (
                        <option key={idx} value={idx}>
                          {idx + 1}. Satır ({preview || 'Boş'})
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Eşleştirme Seçicileri */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-white p-3 ring-1 ring-blue-200">
                  <label className="mb-1 block text-xs font-extrabold text-blue-900">
                    Referans / Stok Kodu Başlığı *
                  </label>
                  <select
                    value={refCol}
                    onChange={(e) => setRefCol(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-bold text-slate-900"
                  >
                    <option value={-1}>— Sütun Seçiniz —</option>
                    {columnOptions.map((c) => (
                      <option key={c.idx} value={c.idx}>
                        {c.label} {c.sample ? `(Örn: ${c.sample.slice(0, 22)})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl bg-white p-3 ring-1 ring-blue-200">
                  <label className="mb-1 block text-xs font-extrabold text-blue-900">
                    Komponent / Stok Tanımı Başlığı *
                  </label>
                  <select
                    value={descCol}
                    onChange={(e) => setDescCol(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-bold text-slate-900"
                  >
                    <option value={-1}>— Sütun Seçiniz —</option>
                    {columnOptions.map((c) => (
                      <option key={c.idx} value={c.idx}>
                        {c.label} {c.sample ? `(Örn: ${c.sample.slice(0, 26)})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Raf / Göz Kodu Başlığı (Opsiyonel)
                  </label>
                  <select
                    value={shelfCol}
                    onChange={(e) => setShelfCol(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-semibold text-slate-700"
                  >
                    <option value={-1}>— Bu Bilgiyi Alma (Boş Bırak) —</option>
                    {columnOptions.map((c) => (
                      <option key={c.idx} value={c.idx}>
                        {c.label} {c.sample ? `(Örn: ${c.sample.slice(0, 20)})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Paket / Birim / Miktar Notu (Opsiyonel)
                  </label>
                  <select
                    value={unitCol}
                    onChange={(e) => setUnitCol(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-semibold text-slate-700"
                  >
                    <option value={-1}>— Bu Bilgiyi Alma (Boş Bırak) —</option>
                    {columnOptions.map((c) => (
                      <option key={c.idx} value={c.idx}>
                        {c.label} {c.sample ? `(Örn: ${c.sample.slice(0, 20)})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Bölüm Atama Tercihi */}
              <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
                <div className="rounded-xl bg-amber-50/70 p-3 ring-1 ring-amber-200">
                  <label className="mb-1 block text-xs font-extrabold text-amber-950">
                    2. Bölüm Rengi Nasıl Atansın?
                  </label>
                  <select
                    value={targetSectionId === null ? 'NONE' : String(targetSectionId)}
                    onChange={(e) =>
                      setTargetSectionId(
                        e.target.value === 'NONE' ? null : Number(e.target.value)
                      )
                    }
                    className="w-full rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-xs font-extrabold text-slate-900"
                  >
                    <option value="NONE">
                      ⏳ Bölüm Seçmeden Aktar (Sonra Tablodan Tek Tek Kendim Seçeceğim)
                    </option>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        Tümünü &quot;{s.name}&quot; Bölümüne Ata
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Excel&apos;de Bölüm Sütunu Varsa (Opsiyonel)
                  </label>
                  <select
                    value={sectionCol}
                    onChange={(e) => setSectionCol(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-semibold text-slate-700"
                  >
                    <option value={-1}>
                      — Excel&apos;de Bölüm Sütunu Yok —
                    </option>
                    {columnOptions.map((c) => (
                      <option key={c.idx} value={c.idx}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Canlı Eşleştirme Önizleme Tablosu */}
              {mappedRows.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-100/70 px-3.5 py-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-extrabold text-slate-800">
                      <Table2 className="h-3.5 w-3.5 text-emerald-600" />
                      Aktarılacak Veri Önizlemesi (İlk 5 Kayıt)
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-black text-emerald-800">
                      Toplam {mappedRows.length} Stok Kodu Hazır
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase">
                          <th className="px-3 py-2">Referans (Stok Kodu)</th>
                          <th className="px-3 py-2">Tanımı</th>
                          <th className="px-3 py-2">Raf</th>
                          <th className="px-3 py-2">Paket/Not</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {mappedRows.slice(0, 5).map((r, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5 font-mono font-black text-slate-900">
                              {r.reference_code}
                            </td>
                            <td className="px-3 py-1.5 font-medium text-slate-700">
                              {r.description}
                            </td>
                            <td className="px-3 py-1.5 text-slate-500">
                              {r.shelf_code || '-'}
                            </td>
                            <td className="px-3 py-1.5 text-slate-500">
                              {r.unit_info || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {feedback && (
            <div
              className={`flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-extrabold ring-1 ${
                feedback.type === 'ok'
                  ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                  : 'bg-rose-50 text-rose-700 ring-rose-200'
              }`}
            >
              {feedback.type === 'ok' && (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              )}
              {feedback.msg}
            </div>
          )}
        </div>

        {/* Alt Aksiyon Çubuğu */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
          <span className="text-xs font-semibold text-slate-500">
            {mappedRows.length > 0
              ? `${mappedRows.length} stok kodu programa aktarılacak`
              : 'Başlamak için Excel dosyası seçin veya tablo yapıştırın'}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Kapat
            </button>
            <button
              type="button"
              disabled={importing || mappedRows.length === 0}
              onClick={handleImportSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-40"
            >
              <Upload className="h-4 w-4" />
              {importing
                ? 'Aktarılıyor...'
                : `${mappedRows.length} Stok Kodunu Programa Aktar`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
