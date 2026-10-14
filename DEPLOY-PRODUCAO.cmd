@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if not exist "package.json" (
  echo [ERRO] package.json nao encontrado na raiz do projeto.
  goto :failure
)

if not exist "scripts\deploy-force.ps1" (
  echo [ERRO] scripts\deploy-force.ps1 nao encontrado.
  goto :failure
)

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado no PATH.
  goto :failure
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERRO] npm.cmd nao foi encontrado no PATH.
  goto :failure
)

echo ============================================================
echo  RHiD - PUBLICACAO DE NOVA VERSAO EM PRODUCAO
echo ============================================================
echo.
echo Este fluxo ira:
echo   1. incrementar a versao patch;
echo   2. validar lint, testes e build;
echo   3. criar commit e enviar a branch main;
echo   4. criar backup do frontend atual;
echo   5. publicar o frontend na Hostinger;
echo   6. verificar versao, hash, API e caminhos sensiveis.
echo.
echo Consulte MANUAL-DEPLOY-PRODUCAO.md em caso de duvida.
echo.

choice /C SN /N /M "Confirma a publicacao em producao? [S/N]: "
if errorlevel 2 (
  echo.
  echo Operacao cancelada. Nenhuma etapa foi iniciada por este atalho.
  exit /b 0
)

echo.
call npm.cmd run deploy:force
set "DEPLOY_EXIT=%ERRORLEVEL%"

if not "%DEPLOY_EXIT%"=="0" (
  echo.
  echo [ERRO] O fluxo foi interrompido. Leia a mensagem acima antes de tentar novamente.
  echo [ATENCAO] Nao repita o fluxo completo se o commit e o push ja tiverem ocorrido.
  goto :failure_with_code
)

echo.
echo [OK] Nova versao publicada e verificada em producao.
echo.
pause
exit /b 0

:failure
set "DEPLOY_EXIT=1"

:failure_with_code
echo.
echo Consulte MANUAL-DEPLOY-PRODUCAO.md.
echo.
pause
exit /b %DEPLOY_EXIT%
