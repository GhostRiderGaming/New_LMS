$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKEND = "$ROOT\backend"
$FRONTEND = "$ROOT\frontend"
$REDIS = "C:\Program Files\Redis\redis-server.exe"

Write-Host ""
Write-Host "  AnimeEdu -- Starting Up..." -ForegroundColor Cyan
Write-Host ""

function Kill-Port {
    param($port)
    $lines = netstat -ano 2>$null | Select-String ":$port "
    foreach ($line in $lines) {
        $parts = ($line -split '\s+') | Where-Object { $_ -ne '' }
        $procId = $parts[-1]
        if ($procId -match '^\d+$' -and $procId -ne '0') {
            try { Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
}

Write-Host "  [1/5] Clearing ports 3000 and 8000..." -ForegroundColor Yellow
Kill-Port 3000
Kill-Port 8000
Start-Sleep -Milliseconds 800

Write-Host "  [2/5] Starting Redis..." -ForegroundColor Yellow
if (Test-Path $REDIS) {
    Start-Process -FilePath $REDIS -WindowStyle Minimized
    Start-Sleep -Seconds 2
    Write-Host "        Redis ready on port 6379" -ForegroundColor Green
} else {
    Write-Host "        Redis not found -- jobs will run in-process" -ForegroundColor DarkYellow
}

Write-Host "  [3/5] Starting Backend API on :8000..." -ForegroundColor Yellow
$backendCmd = "cd `"$BACKEND`"; py -3.11 -m uvicorn app.main:app --reload --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd -WindowStyle Normal
Start-Sleep -Seconds 5

try {
    $h = Invoke-RestMethod "http://localhost:8000/health" -TimeoutSec 5
    Write-Host "        Backend healthy -- status: $($h.status)" -ForegroundColor Green
} catch {
    Write-Host "        Backend still starting up..." -ForegroundColor DarkYellow
}

Write-Host "  [4/5] Starting Celery Worker..." -ForegroundColor Yellow
$celeryCmd = "cd `"$BACKEND`"; py -3.11 -m celery -A app.worker worker --loglevel=info --pool=solo"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $celeryCmd -WindowStyle Normal
Start-Sleep -Seconds 3
Write-Host "        Celery worker started" -ForegroundColor Green

Write-Host "  [5/5] Starting Frontend on :3000..." -ForegroundColor Yellow
$frontendCmd = "cd `"$FRONTEND`"; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -WindowStyle Normal
Start-Sleep -Seconds 8

Write-Host ""
Write-Host "  +--------------------------------------+" -ForegroundColor Green
Write-Host "  |       All Systems Go!                |" -ForegroundColor Green
Write-Host "  +--------------------------------------+" -ForegroundColor Green
Write-Host "  |  App:      http://localhost:3000     |" -ForegroundColor White
Write-Host "  |  API:      http://localhost:8000     |" -ForegroundColor White
Write-Host "  |  API Docs: http://localhost:8000/docs|" -ForegroundColor White
Write-Host "  +--------------------------------------+" -ForegroundColor Green
Write-Host ""

Start-Process "http://localhost:3000"
