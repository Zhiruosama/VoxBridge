; Keep the original signed vendor package intact. VB-CABLE setup is also its uninstaller.
; Distribution terms: https://vb-audio.com/Services/licensing.htm (VB-CABLE distribution).
!include LogicLib.nsh

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
  FunctionEnd
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Stable maintenance entries are recreated on upgrades, including /UPDATE installs.
  CreateDirectory "$SMPROGRAMS\VoxBridge"
  CreateShortcut "$SMPROGRAMS\VoxBridge\Uninstall VoxBridge.lnk" "$INSTDIR\uninstall.exe"
  CreateShortcut "$SMPROGRAMS\VoxBridge\VB-CABLE - Install or Uninstall.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\virtual-microphone\Manage-Virtual-Microphone.ps1"' "$INSTDIR\virtual-microphone\vb-cable\VBCABLE_Setup_x64.exe"

  ; Upgrades, unattended installs and existing driver installations never launch driver setup.
  ${If} $UpdateMode <> 1
  ${AndIf} $PassiveMode <> 1
  ${AndIfNot} ${Silent}
    ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Services\VBAudioVACMME" "ImagePath"
    ${If} $0 == ""
      ${If} $LANGUAGE = 2052
        MessageBox MB_YESNO|MB_ICONQUESTION "是否现在安装虚拟麦克风 VB-CABLE？$\r$\n$\r$\nVB-CABLE 由 VB-Audio 提供：www.vb-cable.com。它是捐赠软件，欢迎支持作者。$\r$\n$\r$\n选择“是”将打开官方安装器，需要管理员权限。请点击 Install Driver，完成后按提示重启电脑。$\r$\n选择“否”可稍后从开始菜单 VoxBridge 文件夹安装。" IDNO voxbridge_driver_done
      ${Else}
        MessageBox MB_YESNO|MB_ICONQUESTION "Install the VB-CABLE virtual microphone now?$\r$\n$\r$\nVB-CABLE is provided by VB-Audio: www.vb-cable.com. It is donationware; contributions are welcome.$\r$\n$\r$\nYes opens the official installer and requires administrator approval. Click Install Driver, then restart Windows as instructed.$\r$\nNo lets you install later from the VoxBridge Start menu folder." IDNO voxbridge_driver_done
      ${EndIf}
      ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\virtual-microphone\Manage-Virtual-Microphone.ps1"' $0
      ; Driver setup cancellation must not roll back the installed application.
    ${EndIf}
  ${EndIf}
  voxbridge_driver_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
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
  Delete "$SMPROGRAMS\VoxBridge\Uninstall VoxBridge.lnk"
  Delete "$SMPROGRAMS\VoxBridge\VB-CABLE - Install or Uninstall.lnk"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  RMDir "$SMPROGRAMS\VoxBridge"
!macroend
