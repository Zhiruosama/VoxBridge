; Single-file bootstrapper: the app renders setup, NSIS remains the install engine.
Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma
Name "VoxBridge"
Icon "${SETUP_ICON}"
OutFile "${SETUP_OUTPUT}"
!include FileFunc.nsh
!include LogicLib.nsh
!include x64.nsh
Var SetupArgs
Var SetupResult

Function .onInit
  ${GetParameters} $SetupArgs
  ; Preserve updater /S and /P behavior; never show setup during background updates.
  IfSilent unattended 0
  ${GetOptions} $SetupArgs "/P" $0
  ${IfNot} ${Errors}
    Goto unattended
  ${EndIf}
  SetSilent silent
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=setup-payload.exe "${SETUP_PAYLOAD}"
  ; Without WebView2, the existing native installer supplies prerequisite setup.
  SetRegView 32
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  SetRegView 64
  ${If} $0 == ""
    ReadRegStr $0 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $0 == ""
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $0 == ""
    ExecWait '"$PLUGINSDIR\setup-payload.exe" $SetupArgs' $SetupResult
  ${Else}
    !ifdef SETUP_WEBVIEW2_LOADER
      File /oname=WebView2Loader.dll "${SETUP_WEBVIEW2_LOADER}"
    !endif
    File /oname=voxbridge-setup-ui.exe "${SETUP_UI}"
    ExecWait '"$PLUGINSDIR\voxbridge-setup-ui.exe" --voxbridge-setup' $SetupResult
  ${EndIf}
  ${If} ${Errors}
    StrCpy $SetupResult 2
  ${EndIf}
  SetErrorLevel $SetupResult
  Quit
  unattended:
    SetSilent silent
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File /oname=setup-payload.exe "${SETUP_PAYLOAD}"
    ExecWait '"$PLUGINSDIR\setup-payload.exe" $SetupArgs' $SetupResult
    ${If} ${Errors}
      StrCpy $SetupResult 2
    ${EndIf}
    SetErrorLevel $SetupResult
    Quit
FunctionEnd
Section
SectionEnd
