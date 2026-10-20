@echo off
chcp 65001 > nul
title 인카운터 시각적 노드 편집기 (Encounter Node Editor)
echo ===================================================
echo   인카운터 시각적 노드 편집기를 실행합니다...
echo   브라우저가 자동으로 열립니다.
echo ===================================================
cd /d "%~dp0\.."
python tools\encounter_editor.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo 파이썬 실행 중 오류가 발생했거나 종료되었습니다.
    echo 브라우저에서 tools\encounter_editor.html 파일을 직접 열어도 사용하실 수 있습니다.
    pause
)

