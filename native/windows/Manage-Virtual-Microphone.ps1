$ErrorActionPreference = 'Stop'
try {
    $directory = Join-Path $PSScriptRoot 'vb-cable'
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
    # Official setup displays Install Driver or Remove Driver according to driver state.
    $process = Start-Process -FilePath $installer -WorkingDirectory $directory -Verb RunAs -Wait -PassThru
    exit $process.ExitCode
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'VoxBridge - VB-CABLE') | Out-Null
    exit 1
}
