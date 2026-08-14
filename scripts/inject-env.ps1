# inject-env.ps1
# Sustituye placeholders %%VAR%% con valores de variables de entorno.
# Se ejecuta en GitHub Actions antes de firebase deploy.
# Las variables se definen en GitHub Settings > Secrets and variables > Actions.
#
# DEPLOY COMPLETO (en GitHub Actions, después de este script):
#   firebase deploy --only hosting,firestore:rules
# Esto despliega simultáneamente el panel (con CSP) y las Firestore Security Rules.

$files = @("index.html", "js\firebase-config.js")

$replacements = @{
  "%%FIREBASE_API_KEY%%"            = $env:FIREBASE_API_KEY
  "%%FIREBASE_AUTH_DOMAIN%%"        = $env:FIREBASE_AUTH_DOMAIN
  "%%FIREBASE_PROJECT_ID%%"         = $env:FIREBASE_PROJECT_ID
  "%%FIREBASE_STORAGE_BUCKET%%"     = $env:FIREBASE_STORAGE_BUCKET
  "%%FIREBASE_MESSAGING_SENDER_ID%%"= $env:FIREBASE_MESSAGING_SENDER_ID
  "%%FIREBASE_APP_ID%%"             = $env:FIREBASE_APP_ID
  "%%MAPS_API_KEY%%"                = $env:MAPS_API_KEY
}

foreach ($file in $files) {
  $content = Get-Content $file -Raw -Encoding UTF8
  foreach ($placeholder in $replacements.Keys) {
    $value = $replacements[$placeholder]
    if ($value) {
      $content = $content -replace [regex]::Escape($placeholder), $value
    }
  }
  Set-Content $file $content -Encoding UTF8
}

Write-Host "Variables de entorno inyectadas correctamente."
