# ══════════════════════════════════════════════════════════════
# programar-tarea.ps1
# Crea una tarea en Windows Task Scheduler para ejecutar el
# backup de Firestore automáticamente cada 2 semanas.
#
# EJECUTAR UNA SOLA VEZ, como Administrador:
#   .\programar-tarea.ps1
# ══════════════════════════════════════════════════════════════

$NOMBRE_TAREA  = "BackupFirestore_N10"
$DESCRIPCION   = "Backup bi-semanal de Firestore para el ERP N-10"
$HORA_EJECUCION = "08:00"   # hora del día que ejecuta el backup
$DIA_SEMANA    = "Monday"   # lunes de cada 2 semanas
$SCRIPT_PATH   = Join-Path $PSScriptRoot "ejecutar-backup.ps1"

if (-not (Test-Path $SCRIPT_PATH)) {
  Write-Error "No se encontró ejecutar-backup.ps1 en: $SCRIPT_PATH"
  exit 1
}

# ── Eliminar tarea anterior si existe ────────────────────────
if (Get-ScheduledTask -TaskName $NOMBRE_TAREA -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $NOMBRE_TAREA -Confirm:$false
  Write-Host "Tarea anterior eliminada."
}

# ── Acción: ejecutar PowerShell con el script ─────────────────
$accion = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$SCRIPT_PATH`""

# ── Disparador: cada 2 semanas el día y hora configurados ─────
# Task Scheduler no tiene disparador nativo bi-semanal,
# se usa semanal con intervalo de 2 semanas (RepetitionInterval).
$disparador = New-ScheduledTaskTrigger `
  -Weekly `
  -WeeksInterval 2 `
  -DaysOfWeek $DIA_SEMANA `
  -At $HORA_EJECUCION

# ── Configuración: ejecutar aunque no haya sesión abierta ─────
$config = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -StartWhenAvailable `
  -WakeToRun

# ── Registrar la tarea ────────────────────────────────────────
$tarea = Register-ScheduledTask `
  -TaskName   $NOMBRE_TAREA `
  -Description $DESCRIPCION `
  -Action     $accion `
  -Trigger    $disparador `
  -Settings   $config `
  -RunLevel   Highest `
  -Force

Write-Host "`n✓ Tarea programada: '$NOMBRE_TAREA'" -ForegroundColor Green
Write-Host "  Frecuencia: cada 2 semanas los $DIA_SEMANA a las $HORA_EJECUCION"
Write-Host "  Script:     $SCRIPT_PATH"
Write-Host ""
Write-Host "Para ejecutar manualmente ahora:"
Write-Host "  Start-ScheduledTask -TaskName '$NOMBRE_TAREA'"
Write-Host ""
Write-Host "Para ver el estado:"
Write-Host "  Get-ScheduledTask -TaskName '$NOMBRE_TAREA' | Get-ScheduledTaskInfo"
