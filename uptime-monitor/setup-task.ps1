# Setup Windows Task Scheduler for Uptime Monitor
# Run as Administrator

$taskName = "UptimeMonitor"
$scriptPath = "$env:USERPROFILE\mcp-servers\uptime-monitor\monitor.js"
$workingDir = "$env:USERPROFILE\mcp-servers\uptime-monitor"

# Remove existing task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create action - run node with the monitor script
$action = New-ScheduledTaskAction -Execute "node" -Argument $scriptPath -WorkingDirectory $workingDir

# Create trigger - at logon
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Create settings
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -RestartCount 3 `
    -ExecutionTimeLimit (New-TimeSpan -Days 365)

# Create principal (run as current user)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# Register the task
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $triggerLogon `
    -Settings $settings `
    -Principal $principal `
    -Description "Monitors client websites and alerts on downtime"

Write-Host ""
Write-Host "=" * 50 -ForegroundColor Cyan
Write-Host "Uptime Monitor Task Scheduled!" -ForegroundColor Green
Write-Host "=" * 50 -ForegroundColor Cyan
Write-Host ""
Write-Host "Task Name: $taskName" -ForegroundColor White
Write-Host "Trigger: At user logon" -ForegroundColor White
Write-Host "Script: $scriptPath" -ForegroundColor White
Write-Host ""
Write-Host "The monitor will start automatically when you log in." -ForegroundColor Yellow
Write-Host ""
Write-Host "To start now: node $scriptPath" -ForegroundColor Cyan
Write-Host "To check status: Get-ScheduledTask -TaskName $taskName" -ForegroundColor Cyan
Write-Host ""
