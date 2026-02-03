# Stop Claude Receptionist
Write-Host "Stopping Claude Receptionist..." -ForegroundColor Yellow

$processes = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*receptionist.js*"
}

if ($processes) {
    $processes | Stop-Process -Force
    Write-Host "Receptionist stopped." -ForegroundColor Green
} else {
    Write-Host "No receptionist process found." -ForegroundColor Gray
}
