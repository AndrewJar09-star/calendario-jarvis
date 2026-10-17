@echo off
chcp 65001 > nul
title S.T.E.W.A.R.D. OS - Avvio Server
cls
echo =====================================================================
echo           S.T.E.W.A.R.D. OS — SISTEMA DI GESTIONE TURNI
echo                   Iron Man / J.A.R.V.I.S. Edition
echo =====================================================================
echo.
echo Avvio del server in corso...
echo.

set PYTHON_EXE=C:\Users\veloc\AppData\Local\Programs\Python\Python312\python.exe

:: Apre il browser dopo 2 secondi per dare a Uvicorn il tempo di avviarsi
start "" cmd /c "timeout /t 2 /nobreak > nul & start http://127.0.0.1:8000"

if exist "%PYTHON_EXE%" (
    echo [OK] Trovato Python 3.12: %PYTHON_EXE%
    "%PYTHON_EXE%" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
) else (
    echo [INFO] Cerco Python nel PATH di sistema...
    python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
)

pause
