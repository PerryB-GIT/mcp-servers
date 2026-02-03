# Start Claude Receptionist
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "Starting Claude Receptionist..." -ForegroundColor Cyan
Write-Host "WhatsApp: +1 978-608-7334 (Support-Forge)" -ForegroundColor Green
Write-Host ""

node receptionist.js
