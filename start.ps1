# Komponent Raf Etiket & Telegram Talep Sistemi - Yerel Başlatıcı
Write-Host "FastAPI Backend (8000) ve React Frontend (5173) baslatiliyor..." -ForegroundColor Cyan

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; .\.venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8000 --reload"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; npm run dev"

Write-Host "Arayuz: http://localhost:5173" -ForegroundColor Green
