; Keep the original signed vendor package intact. VB-CABLE setup is also its uninstaller.
; Distribution terms: https://vb-audio.com/Services/licensing.htm (VB-CABLE distribution).
!include LogicLib.nsh
!include "${__FILEDIR__}\uninstall-safety.nsh"
!include "${__FILEDIR__}\installer-ui.nsh"

; Tauri includes hooks before declaring UpdateMode. Extend the deferred MUI GUI-init
; macro so the variable exists when compiled. Preserve the upstream MUI callbacks.
!macroundef MUI_FUNCTION_GUIINIT
!macro MUI_FUNCTION_GUIINIT
  Function .onGUIInit
    !insertmacro MUI_GUIINIT_OUTERDIALOG ""
    !ifdef MUI_PAGE_FUNCTION_GUIINIT
      Call "${MUI_PAGE_FUNCTION_GUIINIT}"
    !endif
    !ifdef MUI_CUSTOMFUNCTION_GUIINIT
      Call "${MUI_CUSTOMFUNCTION_GUIINIT}"
    !endif
    ; Double-click upgrades use the same data-preserving path as /UPDATE.
    ReadRegStr $0 SHCTX "${UNINSTKEY}" "UninstallString"
    ${If} $0 != ""
      StrCpy $UpdateMode 1
    ${EndIf}
    Call VoxBridgeInitializeUI
  FunctionEnd
!macroend

!macro NSIS_HOOK_PREINSTALL
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\VoxBridgeInstaller") p.r0 ?e'
  Pop $1
  ${If} $0 = 0
  ${OrIf} $1 = 183
    Abort "Another VoxBridge installation is running. Please close it and retry."
  ${EndIf}
  ; Silent setup does not visit the Start menu or finish pages.
  StrCpy $AppStartMenuFolder "VoxBridge"
  ${GetOptions} $CMDLINE "/NODESKTOP" $0
  ${IfNot} ${Errors}
    StrCpy $NoShortcutMode 1
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Stable maintenance entries are recreated on upgrades, including /UPDATE installs.
  CreateDirectory "$SMPROGRAMS\VoxBridge"
  CreateShortcut "$SMPROGRAMS\VoxBridge\Uninstall VoxBridge.lnk" "$INSTDIR\uninstall.exe"
  ${GetOptions} $CMDLINE "/NODESKTOP" $0
  ${IfNot} ${Errors}
    CreateShortcut "$SMPROGRAMS\VoxBridge\VoxBridge.lnk" "$INSTDIR\voxbridge.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\VoxBridge\VoxBridge.lnk"
  ${Else}
    ${GetOptions} $CMDLINE "/DESKTOP" $0
    ${IfNot} ${Errors}
      CreateShortcut "$DESKTOP\VoxBridge.lnk" "$INSTDIR\voxbridge.exe"
    ${EndIf}
  ${EndIf}
  CreateShortcut "$SMPROGRAMS\VoxBridge\VB-CABLE - Install or Uninstall.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\virtual-microphone\Manage-Virtual-Microphone.ps1"' "$INSTDIR\virtual-microphone\vb-cable\VBCABLE_Setup_x64.exe"

  ; Upgrades, unattended installs and existing driver installations never launch driver setup.
  ${If} $UpdateMode <> 1
  ${AndIf} $PassiveMode <> 1
  ${AndIfNot} ${Silent}
  ${AndIf} $VoxBridgeDriverChoice = 1
    ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Services\VBAudioVACMME" "ImagePath"
    ${If} $0 == ""
      DetailPrint "$(VoxBridgeDriverProgress)"
      ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\virtual-microphone\Manage-Virtual-Microphone.ps1"' $0
      ; Driver setup cancellation must not roll back the installed application.
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro VOXBRIDGE_ASSERT_APP_STOPPED
  ; Only the explicit UI choice opts into Tauri's existing data-removal path.
  ${GetOptions} $CMDLINE "/DELETEAPPDATA" $0
  ${IfNot} ${Errors}
  ${AndIf} $UpdateMode <> 1
    StrCpy $DeleteAppDataCheckboxState 1
  ${EndIf}
  ; Never remove a shared driver automatically, or open its setup during updates.
  ${If} $UpdateMode <> 1
  ${AndIf} $PassiveMode <> 1
  ${AndIfNot} ${Silent}
    ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Services\VBAudioVACMME" "ImagePath"
    ${If} $0 != ""
      ${If} $LANGUAGE = 2052
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时打开 VB-CABLE 卸载程序？$\r$\n$\r$\n其他软件可能也在使用这个驱动，默认保留。$\r$\n如需卸载，请在官方管理器中点击 Remove Driver，完成后按提示重启电脑。" IDNO voxbridge_driver_uninstall_done
      ${Else}
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Open the VB-CABLE driver uninstaller too?$\r$\n$\r$\nOther apps may use this driver, so it is kept by default.$\r$\nTo remove it, click Remove Driver in the official manager, then restart Windows as instructed." IDNO voxbridge_driver_uninstall_done
      ${EndIf}
      ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\virtual-microphone\Manage-Virtual-Microphone.ps1"' $0
    ${EndIf}
  ${EndIf}
  voxbridge_driver_uninstall_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Only remove maintenance entries after the engine has completed successfully.
  Delete "$SMPROGRAMS\VoxBridge\Uninstall VoxBridge.lnk"
  Delete "$SMPROGRAMS\VoxBridge\VB-CABLE - Install or Uninstall.lnk"
  RMDir "$SMPROGRAMS\VoxBridge"
!macroend
