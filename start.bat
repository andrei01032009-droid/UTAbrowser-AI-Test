@echo off
chcp 65001 >nul
title UTA Browser
cd /d "%~dp0"

echo ============================================
echo   UTA Browser — запуск
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [!] Node.js не найден на компьютере.
    echo.
    echo 1) Открой https://nodejs.org и скачай версию LTS
    echo 2) Установи её (просто жми "Далее")
    echo 3) Запусти этот файл ещё раз
    echo.
    pause
    exit /b 1
)

if not exist node_modules (
    echo Первый запуск: устанавливаю зависимости...
    call npm install
    if errorlevel 1 (
        echo [!] Ошибка установки. Проверь интернет и попробуй ещё раз.
        pause
        exit /b 1
    )
)

echo.
echo Запускаю сервер UTA...
echo.
echo    >>>  Когда увидишь надпись "UTA Browser запущен",
echo         открой в браузере:  http://localhost:3000
echo.
echo    >>>  НЕ закрывай это окно, пока пользуешься UTA!
echo.
call npm start

pause
