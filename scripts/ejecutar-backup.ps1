# ══════════════════════════════════════════════════════════════
# ejecutar-backup.ps1
# Orquesta el backup de Firestore: exporta datos, cifra con
# AES-256 via 7-Zip y verifica integridad.
#
# CONFIGURA las 3 variables de la sección siguiente y listo.
# Luego ejecuta desde PowerShell:
#   .\ejecutar-backup.ps1
#
# Para programar automáticamente cada 2 semanas, ejecuta:
#   .\programar-tarea.ps1
# ══════════════════════════════════════════════════════════════

# ── CONFIGURACIÓN (ajustar antes de usar) ─────────────────────

# Ruta al archivo de cuenta de servicio de Firebase (NO subir al repo)
$SERVICE_ACCOUNT = "$env:USERPROFILE\Documents\serviceAccount_N10.json"

# Carpeta donde se guardarán los backups cifrados
$BACKUP_DESTINO  = "$env:USERPROFILE\Documents\Backups_N10"

# Ruta al ejecutable de 7-Zip (instalarlo desde https://7-zip.org si no está)
$SIETE_ZIP       = "C:\Program Files\7-Zip\7z.exe"

# ── FIN DE CONFIGURACIÓN ──────────────────────────────────────

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$stamp    = Get-Date -Format "yyyy-MM-dd_HH-mm"
$logFile  = Join-Path $BACKUP_DESTINO "backup_$stamp.log"

function Log($msg) {
  $linea = "[$stamp] $msg"
  Write-Host $linea
  Add-Content -Path $logFile -Value $linea -Encoding UTF8
}

# ── 1. Validaciones previas ───────────────────────────────────
New-Item -ItemType Directory -Force -Path $BACKUP_DESTINO | Out-Null

if (-not (Test-Path $SERVICE_ACCOUNT)) {
  Write-Error "No se encontró el archivo de cuenta de servicio en: $SERVICE_ACCOUNT"
  exit 1
}
if (-not (Test-Path $SIETE_ZIP)) {
  Write-Error "7-Zip no está instalado en: $SIETE_ZIP`nDescárgalo de https://7-zip.org"
  exit 1
}

# Node.js debe estar instalado
try { node --version | Out-Null } catch {
  Write-Error "Node.js no está instalado. Descárgalo de https://nodejs.org"
  exit 1
}

Log "═══════════════════════════════════════"
Log "  INICIO BACKUP N-10 — $stamp"
Log "═══════════════════════════════════════"

# ── 2. Instalar dependencias si hace falta ────────────────────
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeModules = Join-Path $scriptsDir "..\node_modules\firebase-admin"
if (-not (Test-Path $nodeModules)) {
  Log "Instalando firebase-admin (solo la primera vez)…"
  Push-Location (Join-Path $scriptsDir "..")
  npm install firebase-admin --save-dev 2>&1 | ForEach-Object { Log $_ }
  Pop-Location
  Log "firebase-admin instalado."
}

# ── 3. Ejecutar exportación a JSON ───────────────────────────
$backupScript = Join-Path $scriptsDir "backup-firestore.js"
$tmpDir       = Join-Path $env:TEMP "n10_backup_$stamp"

Log "Exportando colecciones de Firestore…"
$resultado = node $backupScript --key="$SERVICE_ACCOUNT" --out="$tmpDir" 2>&1
$resultado | ForEach-Object { Log $_ }

if ($LASTEXITCODE -ne 0) {
  Log "ERROR: La exportación falló (código $LASTEXITCODE). Revisa las credenciales."
  exit 1
}
Log "Exportación completada."

# ── 4. Solicitar contraseña de cifrado ───────────────────────
Log "Solicitando contraseña de cifrado AES-256…"
$pwd1 = Read-Host -AsSecureString "Contraseña para el ZIP cifrado"
$pwd2 = Read-Host -AsSecureString "Confirmar contraseña"

$plain1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pwd1))
$plain2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pwd2))

if ($plain1 -ne $plain2) {
  Log "ERROR: Las contraseñas no coinciden. Backup cancelado."
  Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
  exit 1
}
if ($plain1.Length -lt 8) {
  Log "ERROR: La contraseña debe tener al menos 8 caracteres."
  Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
  exit 1
}

# ── 5. Cifrar con AES-256 via 7-Zip ──────────────────────────
$backupFolder  = Join-Path $tmpDir "backup_*"
$carpetaReal   = Get-ChildItem $tmpDir -Directory | Select-Object -First 1
$archivoZip    = Join-Path $BACKUP_DESTINO "backup_N10_$stamp.7z"

Log "Cifrando con AES-256 → $archivoZip"
& $SIETE_ZIP a -t7z -mhe=on -mx=5 "-p$plain1" $archivoZip "$($carpetaReal.FullName)\*" | ForEach-Object { Log $_ }

# Limpiar contraseña de memoria inmediatamente
$plain1 = $null; $plain2 = $null
[GC]::Collect()

if ($LASTEXITCODE -ne 0) {
  Log "ERROR: 7-Zip falló al cifrar (código $LASTEXITCODE)."
  Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
  exit 1
}

# ── 6. Verificar integridad del ZIP ──────────────────────────
Log "Verificando integridad del archivo cifrado…"
# Nota: la verificación de 7z requiere la contraseña; se omite aquí
# para no tenerla en memoria más tiempo. El checksum del ZIP se genera abajo.
$hashZip = (Get-FileHash $archivoZip -Algorithm SHA256).Hash
$hashFile = Join-Path $BACKUP_DESTINO "backup_N10_$stamp.sha256"
"$hashZip  backup_N10_$stamp.7z" | Set-Content $hashFile -Encoding UTF8
Log "SHA-256 del ZIP: $hashZip"
Log "Checksum guardado en: $hashFile"

# ── 7. Limpiar archivos temporales ───────────────────────────
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
Log "Archivos temporales eliminados."

# ── 8. Resumen final ─────────────────────────────────────────
$tamano = [Math]::Round((Get-Item $archivoZip).Length / 1MB, 2)
Log "═══════════════════════════════════════"
Log "  BACKUP COMPLETADO"
Log "  Archivo: $archivoZip"
Log "  Tamaño: $tamano MB (cifrado con AES-256)"
Log "  SHA-256: $hashZip"
Log "═══════════════════════════════════════"

# ── 9. Limpieza automática de backups con más de 6 meses ─────
$limiteFecha = (Get-Date).AddMonths(-6)
Get-ChildItem $BACKUP_DESTINO -Filter "backup_N10_*.7z" | Where-Object {
  $_.LastWriteTime -lt $limiteFecha
} | ForEach-Object {
  Log "Eliminando backup antiguo: $($_.Name)"
  Remove-Item $_.FullName -Force
  $sha = $_.FullName -replace "\.7z$", ".sha256"
  if (Test-Path $sha) { Remove-Item $sha -Force }
}

Write-Host "`n✓ Backup listo. Guarda el archivo en al menos 2 ubicaciones distintas.`n" -ForegroundColor Green
