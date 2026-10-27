param([switch]$RestoreDefaultsOnly, [string]$PackageDirectory)
$mutex = $null
$ownsMutex = $false
$ErrorActionPreference = 'Stop'
$stateDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'VoxBridge\DriverSetup'
$stateFile = Join-Path $stateDirectory 'audio-defaults.json'
$runOnce = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
$runOnceName = 'VoxBridgeRestoreAudioDefaults'
function Clear-PendingRestore {
    Remove-ItemProperty -LiteralPath $runOnce -Name $runOnceName -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $stateDirectory 'Restore-Audio.ps1') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $stateDirectory 'Audio-Defaults.cs') -Force -ErrorAction SilentlyContinue
}
function Read-AudioSnapshot {
    if (-not (Test-Path -LiteralPath $stateFile)) { return @() }
    if ((Get-Item -LiteralPath $stateFile).Length -gt 65536) { throw 'Invalid audio defaults snapshot.' }
    $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if ($saved.schemaVersion -ne 1 -or ([DateTime]::UtcNow - [DateTime]::Parse($saved.createdUtc).ToUniversalTime()).TotalDays -gt 7) {
        throw 'Audio defaults snapshot has expired.'
    }
    $entries = @($saved.endpoints)
    if ($entries.Count -gt 6) { throw 'Invalid audio defaults snapshot.' }
    $result = @()
    foreach ($entry in $entries) {
        $item = New-Object VoxBridge.DriverSetup.Endpoint
        $item.Flow = [int]$entry.Flow; $item.Role = [int]$entry.Role
        $item.Id = [string]$entry.Id; $item.Active = [bool]$entry.Active; $item.Cable = [bool]$entry.Cable
        $result += $item
    }
    return $result
}
function Restore-AudioDefaults($snapshot) {
    if (@($snapshot).Count -eq 0) { return 0 }
    $restored = 0
    # Device activation can follow the vendor process exit. This is bounded and
    # never touches a user's new physical/default selection or an unplugged endpoint.
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        $result = [VoxBridge.DriverSetup.AudioDefaults]::Restore([VoxBridge.DriverSetup.Endpoint[]]@($snapshot))
        $restored += $result.Restored
        if ($result.Failed -gt 0) { throw 'VB-CABLE setup finished, but the previous default audio devices could not be restored. Please check Windows Sound settings.' }
        if ($attempt -lt 11) { Start-Sleep -Milliseconds 500 }
    }
    return $restored
}
try {
    $mutex = New-Object System.Threading.Mutex($false, 'Local\VoxBridgeDriverSetup')
    $ownsMutex = $mutex.WaitOne(0)
    if (-not $ownsMutex) { throw 'Another VoxBridge driver manager is running. Close it and retry.' }
    Add-Type -Path (Join-Path $PSScriptRoot 'Audio-Defaults.cs')
    if ($RestoreDefaultsOnly) {
        try { $null = Restore-AudioDefaults @(Read-AudioSnapshot) }
        finally { Clear-PendingRestore }
        exit 0
    }
    $directory = if ($PackageDirectory) { $PackageDirectory } else { Join-Path $PSScriptRoot 'vb-cable' }
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'vb-cable-manifest.json') -Raw | ConvertFrom-Json
    foreach ($entry in $manifest.PSObject.Properties) {
        if ((Get-FileHash -LiteralPath (Join-Path $directory $entry.Name) -Algorithm SHA256).Hash -ne $entry.Value) {
            throw 'VB-CABLE package verification failed. Please reinstall VoxBridge.'
        }
    }
    $installer = Join-Path $directory 'VBCABLE_Setup_x64.exe'
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*BUREL VINCENT*') {
        throw 'VB-CABLE installer signature verification failed. Please reinstall VoxBridge.'
    }
    # Capture in the original user's process BEFORE UAC. Only the vendor installer
    # is elevated, so over-the-shoulder admin credentials cannot change the scope.
    $snapshot = @([VoxBridge.DriverSetup.AudioDefaults]::Capture())
    $hadDriver = Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Services\VBAudioVACMME'
    if (-not $hadDriver) {
        New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
        @{ schemaVersion = 1; createdUtc = [DateTime]::UtcNow.ToString('o'); endpoints = $snapshot } |
            ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8
        New-Item -Path $runOnce -Force | Out-Null
        # Keep the recovery helper outside the app so an uninstall before reboot
        # cannot leave the driver-selected defaults behind. Remove it after one run.
        $restoreScript = Join-Path $stateDirectory 'Restore-Audio.ps1'
        Copy-Item -LiteralPath $PSCommandPath -Destination $restoreScript -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Audio-Defaults.cs') -Destination (Join-Path $stateDirectory 'Audio-Defaults.cs') -Force
        $powershell = Join-Path $PSHOME 'powershell.exe'
        $command = '"{0}" -NoP -EP Bypass -W Hidden -File "{1}" -RestoreDefaultsOnly' -f $powershell, $restoreScript
        if ($command.Length -gt 260) { throw 'The Windows user profile path is too long for post-restart audio recovery.' }
        # A one-time check after the required reboot; no persistent startup monitor.
        New-ItemProperty -LiteralPath $runOnce -Name $runOnceName -Value $command -PropertyType String -Force | Out-Null
    }
    try {
        # Keep the original signed vendor package and its interactive consent UI.
        $process = Start-Process -FilePath $installer -WorkingDirectory $directory -Verb RunAs -Wait -PassThru
    } finally {
        $null = Restore-AudioDefaults $snapshot
        if (-not (Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Services\VBAudioVACMME')) { Clear-PendingRestore }
    }
    if (-not $hadDriver -and -not (Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Services\VBAudioVACMME')) {
        throw 'VB-CABLE was not installed. Reopen the manager and click Install Driver, then restart Windows.'
    }
    exit $process.ExitCode
} catch {
    if ($RestoreDefaultsOnly -and $ownsMutex) { Clear-PendingRestore }
    if ($ownsMutex -and -not $RestoreDefaultsOnly -and -not (Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Services\VBAudioVACMME')) { Clear-PendingRestore }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'VoxBridge - VB-CABLE') | Out-Null
    exit 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
