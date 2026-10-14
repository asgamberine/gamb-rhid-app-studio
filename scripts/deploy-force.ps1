param(
  [string]$Message = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent $PSScriptRoot
$uploader = Join-Path $projectRoot '.deploy-upload-static.mjs'
$backupRoot = Join-Path (Split-Path -Parent $projectRoot) 'gamb_rhid-backups'
$productionBase = 'https://gamberine.com.br/gambrhid/'
$apiHealthUrl = 'https://gambrhid-api.gamberine.com.br/api/health'

Set-Location -LiteralPath $projectRoot

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar: $Command $($Arguments -join ' ')"
  }
}

function Get-HttpStatus {
  param([Parameter(Mandatory = $true)][string]$Url)

  try {
    return (Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers @{ 'Cache-Control' = 'no-cache' }).StatusCode
  } catch {
    if ($null -ne $_.Exception.Response) {
      return [int]$_.Exception.Response.StatusCode
    }
    throw
  }
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
      return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $uploader -PathType Leaf)) {
  throw 'Uploader local da Hostinger não encontrado: .deploy-upload-static.mjs'
}

$requiredNode = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot '.nvmrc')).Trim()
$activeNode = (& node --version).Trim().TrimStart('v')
if ($activeNode -ne $requiredNode) {
  throw "Node v$requiredNode é obrigatório; versão ativa: v$activeNode"
}

$branch = (& git branch --show-current).Trim()
if ($branch -ne 'main') {
  throw "Deploy permitido somente a partir de main; branch atual: $branch"
}

Invoke-Checked git fetch origin main
$localHead = (& git rev-parse HEAD).Trim()
$remoteHead = (& git rev-parse origin/main).Trim()
if ($localHead -ne $remoteHead) {
  throw 'main e origin/main estão divergentes. Sincronize antes do deploy.'
}

Invoke-Checked npm.cmd version patch --no-git-tag-version
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$releaseVersion = [string]$packageJson.version

Write-Host "Validando versão $releaseVersion..."
Invoke-Checked npm.cmd run lint
Invoke-Checked npm.cmd run verify:release
Invoke-Checked git diff --check

Invoke-Checked git add --all
$stagedFiles = @(& git diff --cached --name-only)
$forbiddenFiles = @($stagedFiles | Where-Object {
  $_ -match '(^|/)(\.env($|\.)|\.data/|node_modules/|\.deploy-|session\.key$)' -or $_ -match '\.zip$'
})
if ($forbiddenFiles.Count -gt 0) {
  throw "Arquivos proibidos no commit: $($forbiddenFiles -join ', ')"
}

if ([string]::IsNullOrWhiteSpace($Message)) {
  $Message = "chore: publicar versao $releaseVersion"
}
Invoke-Checked git commit -m $Message
Invoke-Checked git push origin main

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $backupRoot "frontend-predeploy-$stamp-v$releaseVersion"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$productionIndex = Join-Path $backupDir 'index.html'
Invoke-WebRequest -UseBasicParsing -Uri ($productionBase + 'index.html') -Headers @{ 'Cache-Control' = 'no-cache' } -OutFile $productionIndex
$indexText = Get-Content -Raw -LiteralPath $productionIndex
$publicPaths = @(
  [regex]::Matches($indexText, '(?:src|href)="(/gambrhid/[^"]+)"') |
    ForEach-Object { $_.Groups[1].Value }
)
$publicPaths += '/gambrhid/sw.js', '/gambrhid/manifest.webmanifest', '/gambrhid/version.json', '/gambrhid/design-system-fallback.js'

foreach ($publicPath in ($publicPaths | Sort-Object -Unique)) {
  $relative = $publicPath.Substring('/gambrhid/'.Length)
  if ([string]::IsNullOrWhiteSpace($relative) -or $relative -eq 'index.html') { continue }
  $target = Join-Path $backupDir ($relative -replace '/', [IO.Path]::DirectorySeparatorChar)
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  try {
    Invoke-WebRequest -UseBasicParsing -Uri ("https://gamberine.com.br$publicPath") -Headers @{ 'Cache-Control' = 'no-cache' } -OutFile $target
  } catch {
    "SKIPPED $publicPath" | Add-Content -LiteralPath (Join-Path $backupDir 'download-errors.txt')
  }
}

$manifest = @(Get-ChildItem -Recurse -File -LiteralPath $backupDir | ForEach-Object {
  [PSCustomObject]@{
    Path = $_.FullName.Substring($backupDir.Length + 1)
    Length = $_.Length
    SHA256 = Get-Sha256 -Path $_.FullName
  }
})
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupDir 'manifest.json')
Write-Host "Backup criado: $backupDir"

Invoke-Checked node $uploader

$temporaryIndex = Join-Path ([IO.Path]::GetTempPath()) "gambrhid-index-$stamp.html"
$temporaryVersion = Join-Path ([IO.Path]::GetTempPath()) "gambrhid-version-$stamp.json"
try {
  Invoke-WebRequest -UseBasicParsing -Uri ($productionBase + 'index.html') -Headers @{ 'Cache-Control' = 'no-cache' } -OutFile $temporaryIndex
  Invoke-WebRequest -UseBasicParsing -Uri ($productionBase + 'version.json') -Headers @{ 'Cache-Control' = 'no-cache' } -OutFile $temporaryVersion

  $localIndexHash = Get-Sha256 -Path (Join-Path $projectRoot 'dist\index.html')
  $productionIndexHash = Get-Sha256 -Path $temporaryIndex
  if ($localIndexHash -ne $productionIndexHash) {
    throw 'O index.html servido não corresponde ao build local.'
  }

  $productionVersion = Get-Content -Raw -LiteralPath $temporaryVersion | ConvertFrom-Json
  if ([string]$productionVersion.version -ne $releaseVersion) {
    throw "Versão servida divergente: $($productionVersion.version)"
  }

  if ((Get-HttpStatus -Url $apiHealthUrl) -ne 200) {
    throw 'A API de produção não respondeu com HTTP 200.'
  }

  foreach ($sensitivePath in @('.env', '.data/test', 'package.json', 'session.key')) {
    $status = Get-HttpStatus -Url ($productionBase + $sensitivePath)
    if ($status -ne 403) {
      throw "Proteção inesperada em ${sensitivePath}: HTTP $status"
    }
  }
} finally {
  Remove-Item -LiteralPath $temporaryIndex, $temporaryVersion -Force -ErrorAction SilentlyContinue
}

Write-Host "Deploy v$releaseVersion confirmado em produção."
Write-Host "Commit: $((& git rev-parse --short HEAD).Trim())"
Write-Host "Backup: $backupDir"
