# Portable policy/compiler tests. Never instantiate COM or change audio defaults.
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'Audio-Defaults.cs')
function Endpoint($id, $cable = $false, $active = $true, $flow = 1, $role = 0) {
    $e = New-Object VoxBridge.DriverSetup.Endpoint
    $e.Id = $id; $e.Cable = $cable; $e.Active = $active; $e.Flow = $flow; $e.Role = $role
    return $e
}
function Assert($condition, $message) { if (-not $condition) { throw $message } }
$before = Endpoint 'saved-mic'
$current = Endpoint 'cable-output' $true
$available = Endpoint 'saved-mic'
Assert ([VoxBridge.DriverSetup.AudioDefaults]::ShouldRestore($before, $current, $available)) 'Installer-selected cable must restore original microphone.'
foreach ($role in 0..2) { foreach ($flow in 0..1) {
    Assert ([VoxBridge.DriverSetup.AudioDefaults]::ShouldRestore((Endpoint 'saved' $false $true $flow $role), (Endpoint 'cable' $true $true $flow $role), (Endpoint 'saved' $false $true $flow $role))) 'All render/capture roles must preserve their own endpoints.'
} }
Assert (-not [VoxBridge.DriverSetup.AudioDefaults]::ShouldRestore($before, (Endpoint 'new-user-choice'), $available)) 'Never overwrite a new physical selection.'
Assert (-not [VoxBridge.DriverSetup.AudioDefaults]::ShouldRestore($before, $current, (Endpoint 'saved-mic' $false $false))) 'Never restore unplugged devices.'
Assert (-not [VoxBridge.DriverSetup.AudioDefaults]::ShouldRestore($null, $current, $available)) 'Do not invent a missing previous default.'
Assert (-not [VoxBridge.DriverSetup.AudioDefaults]::ShouldRestore($before, $null, $available)) 'Do not invent a missing current default.'
Assert (-not [VoxBridge.DriverSetup.AudioDefaults]::ShouldRestore($before, $current, (Endpoint 'saved-mic' $false $true 0))) 'Do not cross audio directions.'
Assert (-not [VoxBridge.DriverSetup.AudioDefaults]::ShouldRestore((Endpoint 'saved-mic' $true), $current, $available)) 'Preserve previous virtual-device preferences.'
Assert (-not [VoxBridge.DriverSetup.AudioDefaults]::ShouldRestore($before, (Endpoint 'saved-mic' $true), $available)) 'Do not reset an unchanged default.'
Assert (-not [VoxBridge.DriverSetup.AudioDefaults]::ShouldRestore((Endpoint 'saved-mic' $false $true 1 99), $current, $available)) 'Reject unknown roles.'
Assert ([VoxBridge.DriverSetup.AudioDefaults]::IsCable('CABLE In 16ch (VB-Audio Virtual Cable)', '', '')) 'Recognize base cable multi-channel output.'
Assert ([VoxBridge.DriverSetup.AudioDefaults]::IsCable('renamed by user', '', 'VB-Audio Virtual Cable')) 'Recognize vendor identity after renaming.'
Assert (-not [VoxBridge.DriverSetup.AudioDefaults]::IsCable('VoxBridge (Other Device)', '', '')) 'Names alone must not match unrelated microphones.'
Assert (-not [VoxBridge.DriverSetup.AudioDefaults]::IsCable('CABLE-A Input (VB-Audio Cable A)', '', '')) 'Do not change defaults for other VB products.'
foreach ($file in Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1') {
    $tokens = $null; $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
    Assert ($errors.Count -eq 0) ('PowerShell syntax error in ' + $file.Name)
}
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../src-tauri/tauri.windows.conf.json') -Raw | ConvertFrom-Json
Assert ($config.bundle.resources.'../native/windows/Audio-Defaults.cs' -eq 'virtual-microphone/Audio-Defaults.cs') 'Restoration helper must be shipped in installers.'
Write-Output 'PASS: Core Audio interop compilation, restoration policy, six roles, unavailable devices, user changes, vendor identification, script syntax and bundle resources. No system defaults were read or changed.'
