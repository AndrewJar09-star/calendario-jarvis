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

if exist "%PYTHON_EXE%" (
    echo [OK] Trovato Python 3.12: %PYTHON_EXE%
    start "" http://127.0.0.1:8000
    "%PYTHON_EXE%" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
) else (
    echo [INFO] Cerco Python nel PATH di sistema...
    start "" http://127.0.0.1:8000
    python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
)

pause
