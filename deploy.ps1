# deploy.ps1 — Deploy con verificación de sintaxis previa
# Uso: .\deploy.ps1
# Aborta automáticamente si hay errores de sintaxis en /js/*.js

Write-Host "🔍 Verificando sintaxis JS..." -ForegroundColor Cyan
node check-syntax.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Deploy cancelado por errores de sintaxis." -ForegroundColor Red
    exit 1
}

Write-Host "🚀 Desplegando en Firebase Hosting..." -ForegroundColor Cyan
firebase deploy --only hosting
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Deploy exitoso." -ForegroundColor Green
} else {
    Write-Host "❌ Error en firebase deploy." -ForegroundColor Red
    exit 1
}
