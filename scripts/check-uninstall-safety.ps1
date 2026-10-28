$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskFixture = Join-Path $taskRoot ('native/windows/.build/uninstall-safety-' + (Get-Date -Format yyyyMMdd-HHmmss))
New-Item -ItemType Directory -Path $taskFixture -Force | Out-Null
$taskGuard = Join-Path $taskRoot 'native/windows/uninstall-safety.nsh'
$taskProbe = @'
Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "VoxBridge guard regression"
OutFile "guard.exe"
!include "GUARD_PATH"
Section
  !insertmacro VOXBRIDGE_ASSERT_APP_STOPPED
  FileOpen $1 "$INSTDIR\passed.txt" w
  FileWrite $1 "preflight completed"
  FileClose $1
SectionEnd
'@
[IO.File]::WriteAllText((Join-Path $taskFixture 'guard.nsi'), $taskProbe.Replace('GUARD_PATH', $taskGuard))
Push-Location $taskFixture
try {
    & (Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe') /V2 guard.nsi
    if ($LASTEXITCODE -ne 0) { throw 'Guard fixture compilation failed' }
    foreach ($taskCase in @('stopped', 'locked', 'running')) {
        $taskFolder = Join-Path $taskFixture $taskCase
        New-Item -ItemType Directory -Path $taskFolder | Out-Null
        [IO.File]::WriteAllText((Join-Path $taskFolder 'uninstall.exe'), 'entry-fixture')
        [IO.File]::WriteAllText((Join-Path $taskFolder 'Uninstall VoxBridge.lnk'), 'shortcut-fixture')
        [IO.File]::WriteAllText((Join-Path $taskFolder 'keys.fixture'), 'data-fixture')
        $taskExe = Join-Path $taskFolder 'voxbridge.exe'
        $taskLock = $null
        $taskRunning = $null
        try {
            if ($taskCase -eq 'running') {
                [IO.File]::WriteAllText((Join-Path $taskFolder 'fixture.cs'), 'class Fixture { static void Main() { System.Threading.Thread.Sleep(60000); } }')
                & "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /target:exe "/out:$taskExe" (Join-Path $taskFolder 'fixture.cs')
                if ($LASTEXITCODE -ne 0) { throw 'Fixture executable compilation failed' }
                $taskRunning = Start-Process -FilePath $taskExe -WindowStyle Hidden -PassThru
                Start-Sleep -Milliseconds 300
            } else {
                [IO.File]::WriteAllText($taskExe, 'app-fixture')
                if ($taskCase -eq 'locked') { $taskLock = [IO.File]::Open($taskExe, 'Open', 'Read', 'None') }
            }
            $taskResult = Start-Process -FilePath (Join-Path $taskFixture 'guard.exe') -ArgumentList '/S', "/D=$taskFolder" -WindowStyle Hidden -PassThru -Wait
            $taskExpected = if ($taskCase -eq 'stopped') { 0 } else { 2 }
            if ($taskResult.ExitCode -ne $taskExpected) { throw "Unexpected guard result for $taskCase" }
            if ((Test-Path (Join-Path $taskFolder 'passed.txt')) -ne ($taskCase -eq 'stopped')) { throw 'Busy app passed destructive-operation boundary' }
            foreach ($taskEntry in @('uninstall.exe', 'Uninstall VoxBridge.lnk', 'keys.fixture', 'voxbridge.exe')) {
                if (-not (Test-Path (Join-Path $taskFolder $taskEntry))) { throw 'Fixture entry lost' }
            }
            Write-Output "PASS: $taskCase; expected preflight result; application, uninstall entry and data preserved"
        } finally {
            if ($taskLock) { $taskLock.Dispose() }
            if ($taskRunning -and -not $taskRunning.HasExited) { Stop-Process -Id $taskRunning.Id }
        }
    }
} finally { Pop-Location }
