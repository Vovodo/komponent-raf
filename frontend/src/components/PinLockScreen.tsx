import { Delete, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface PinLockScreenProps {
  onUnlocked: () => void;
}

export function PinLockScreen({ onUnlocked }: PinLockScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submitPin = async (candidate: string) => {
    if (candidate.length !== 8 || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      await api.verifyPin(candidate);
      onUnlocked();
    } catch (err) {
      setError((err as Error).message || 'PIN kodu doğrulanamadı.');
      setPin('');
      setTimeout(() => {
        inputRef.current?.focus();
      }, 40);
    } finally {
      setVerifying(false);
    }
  };

  const handlePinChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    setPin(digits);
    if (error) setError(null);
    if (digits.length === 8) {
      void submitPin(digits);
    }
  };

  const appendDigit = (digit: string) => {
    if (pin.length >= 8 || verifying) return;
    const next = pin + digit;
    handlePinChange(next);
  };

  const backspaceDigit = () => {
    if (verifying || pin.length === 0) return;
    setPin((prev) => prev.slice(0, -1));
    setError(null);
    inputRef.current?.focus();
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 text-white">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-7 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30">
            <Lock className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-xl font-black tracking-tight text-white">
            Yönetim Paneli Girişi
          </h1>
          <p className="mt-1 text-xs font-medium text-slate-400">
            Devam etmek için 8 haneli güvenlik PIN kodunu giriniz
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitPin(pin);
          }}
          className="mt-6 space-y-4"
        >
          {/* 8 Haneli Görsel PIN Kutucukları + Gizli Klavye Girişi */}
          <div
            onClick={() => inputRef.current?.focus()}
            className="relative cursor-text"
          >
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => handlePinChange(e.target.value)}
              className="sr-only"
              aria-label="8 haneli PIN kodu"
            />

            <div className="grid grid-cols-8 gap-1.5">
              {Array.from({ length: 8 }).map((_, idx) => {
                const filled = idx < pin.length;
                const active = idx === pin.length;
                return (
                  <div
                    key={idx}
                    className={`flex h-11 items-center justify-center rounded-xl border text-lg font-black transition ${
                      error
                        ? 'border-rose-500/70 bg-rose-950/40 text-rose-300'
                        : active
                          ? 'border-blue-500 bg-slate-800 ring-2 ring-blue-500/30'
                          : filled
                            ? 'border-slate-600 bg-slate-800 text-white'
                            : 'border-slate-800 bg-slate-950/70 text-slate-600'
                    }`}
                  >
                    {filled ? '•' : ''}
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-500/15 px-3.5 py-2 text-center text-xs font-bold text-rose-300 ring-1 ring-rose-500/30">
              {error}
            </div>
          )}

          {/* Dokunmatik / Fare Numpad */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button
                key={d}
                type="button"
                disabled={verifying}
                onClick={() => appendDigit(d)}
                className="flex h-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-800/70 text-base font-black text-white transition hover:bg-slate-700 active:scale-95 disabled:opacity-40"
              >
                {d}
              </button>
            ))}

            <button
              type="button"
              disabled={verifying || pin.length === 0}
              onClick={() => {
                setPin('');
                setError(null);
                inputRef.current?.focus();
              }}
              className="flex h-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-xs font-bold text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-30"
            >
              Temizle
            </button>

            <button
              type="button"
              disabled={verifying}
              onClick={() => appendDigit('0')}
              className="flex h-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-800/70 text-base font-black text-white transition hover:bg-slate-700 active:scale-95 disabled:opacity-40"
            >
              0
            </button>

            <button
              type="button"
              disabled={verifying || pin.length === 0}
              onClick={backspaceDigit}
              className="flex h-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-300 transition hover:bg-slate-800 hover:text-white disabled:opacity-30"
              title="Sil"
            >
              <Delete className="h-5 w-5" />
            </button>
          </div>

          <button
            type="submit"
            disabled={verifying || pin.length !== 8}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3 text-xs font-black tracking-wide text-white uppercase shadow-lg transition hover:bg-blue-500 disabled:opacity-40"
          >
            <KeyRound className="h-4 w-4" />
            {verifying ? 'Doğrulanıyor...' : 'Giriş Yap'}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] font-medium text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
          Çerez tutulmaz • Her girişte anlık doğrulama istenir
        </div>
      </div>
    </div>
  );
}
