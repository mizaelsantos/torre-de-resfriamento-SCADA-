@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Torre SCADA 3D - Supervisorio
set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY (
  echo.
  echo  Python nao encontrado neste computador.
  echo  Instale o Python 3 em https://www.python.org/downloads/
  echo  e MARQUE a opcao "Add python.exe to PATH" na instalacao.
  echo.
  start "" https://www.python.org/downloads/
  pause
  exit /b 1
)
%PY% servidor.py %*
if errorlevel 1 pause
