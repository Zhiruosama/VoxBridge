$ErrorActionPreference = 'Stop'
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1" -Force
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1" -Force
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Archive/Microsoft.PowerShell.Archive.psd1" -Force
$cache = Join-Path $PSScriptRoot '.build'
$archive = Join-Path $cache 'VBCABLE_Driver_Pack45.zip'
$destination = Join-Path $cache 'VBCABLE_Driver_Pack45'
$expected = 'B950E39F01AF1D04EA623C8F6D8EB9B6EA5C477C637295FABF20631C85116BFB'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip' -OutFile $archive -UseBasicParsing
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) {
    throw 'VB-CABLE archive checksum mismatch. Remove the cached archive and retry.'
}
Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'vb-cable-manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.PSObject.Properties) {
    if ((Get-FileHash -LiteralPath (Join-Path $destination $entry.Name) -Algorithm SHA256).Hash -ne $entry.Value) {
        throw "VB-CABLE package file checksum mismatch: $($entry.Name)"
    }
}
$signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $destination 'VBCABLE_Setup_x64.exe')
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*BUREL VINCENT*') {
    throw 'VB-CABLE installer signature verification failed.'
}
Write-Output 'Verified official VB-CABLE Pack45 resources (VB-Audio donationware).'
