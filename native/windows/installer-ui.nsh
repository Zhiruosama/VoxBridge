; Branded native pages. The MUI page declarations remain upstream-owned;
; only the install-files wrapper adds our review page immediately before copying.
!include nsDialogs.nsh
!include WinMessages.nsh
!include "${__FILEDIR__}\installer-theme.nsh"

SetFont "Segoe UI" 9
SetFont /LANG=2052 "Microsoft YaHei UI" 9
!define MUI_HEADERIMAGE_RIGHT
!define MUI_WELCOMEPAGE_TITLE "$(VoxBridgeWelcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT "$VoxBridgeWelcomeText"
!define MUI_FINISHPAGE_TITLE "$(VoxBridgeFinishTitle)"
!define MUI_FINISHPAGE_TEXT "$(VoxBridgeFinishText)"
!define MUI_FINISHPAGE_RUN_TEXT "$(VoxBridgeRun)"

Var VoxBridgeWelcomeText
Var VoxBridgeDriverChoice
Var VoxBridgeDriverCheckbox
Var VoxBridgeSectionFont

LangString VoxBridgeWelcomeTitle 2052 "欢迎使用 VoxBridge"
LangString VoxBridgeWelcomeTitle 1033 "Welcome to VoxBridge"
LangString VoxBridgeWelcomeFresh 2052 "实时双语字幕，让跨语言交流更轻松。$\r$\n$\r$\n接下来将选择安装位置，并确认是否安装虚拟麦克风。$\r$\n$\r$\n点击“下一步”开始。"
LangString VoxBridgeWelcomeFresh 1033 "Live bilingual captions for easier conversations.$\r$\n$\r$\nChoose an installation folder, then review the optional virtual microphone.$\r$\n$\r$\nClick Next to get started."
LangString VoxBridgeWelcomeUpdate 2052 "检测到电脑中已安装 VoxBridge。$\r$\n$\r$\n本次将更新或修复应用文件，保留已有设置、服务配置和密钥。虚拟麦克风驱动保持原样。$\r$\n$\r$\n请先退出 VoxBridge，再点击“下一步”继续。"
LangString VoxBridgeWelcomeUpdate 1033 "VoxBridge is already installed.$\r$\n$\r$\nSetup will update or repair the app while keeping your settings, service profiles and keys. Your audio driver stays installed.$\r$\n$\r$\nClose VoxBridge, then click Next to continue."
LangString VoxBridgeReadyTitle 2052 "准备安装 VoxBridge"
LangString VoxBridgeReadyTitle 1033 "Ready to install VoxBridge"
LangString VoxBridgeUpdateTitle 2052 "准备更新 VoxBridge"
LangString VoxBridgeUpdateTitle 1033 "Ready to update VoxBridge"
LangString VoxBridgeReadySubtitle 2052 "确认以下选项，然后开始安装。"
LangString VoxBridgeReadySubtitle 1033 "Review your choices before continuing."
LangString VoxBridgeKeepSettings 2052 "已有设置、服务配置和密钥将保留。"
LangString VoxBridgeKeepSettings 1033 "Your settings, service profiles and keys will be kept."
LangString VoxBridgeInstallFolder 2052 "安装位置"
LangString VoxBridgeInstallFolder 1033 "Installation folder"
LangString VoxBridgeMicrophone 2052 "虚拟麦克风"
LangString VoxBridgeMicrophone 1033 "Virtual microphone"
LangString VoxBridgeDriverOption 2052 "安装 VB-CABLE 虚拟麦克风（可选）"
LangString VoxBridgeDriverOption 1033 "Install the VB-CABLE virtual microphone (optional)"
LangString VoxBridgeDriverHelp 2052 "向 Discord、Oopz、KOOK 等软件发送语音时需要。将打开官方驱动安装器，需要管理员确认，可能需要重启电脑。"
LangString VoxBridgeDriverHelp 1033 "Needed to send speech to Discord, Oopz or KOOK. Opens the official driver installer, requires administrator approval and may require a restart."
LangString VoxBridgeDriverInstalled 2052 "已检测到 VB-CABLE，将保留现有驱动。"
LangString VoxBridgeDriverInstalled 1033 "VB-CABLE is installed. Your existing driver will be kept."
LangString VoxBridgeDriverLater 2052 "如需安装或卸载驱动，可在开始菜单的 VoxBridge 文件夹中打开驱动管理器。"
LangString VoxBridgeDriverLater 1033 "You can install or remove the driver later from the VoxBridge folder in the Start menu."
LangString VoxBridgeDriverUnchanged 2052 "本次更新不会安装或卸载音频驱动。"
LangString VoxBridgeDriverUnchanged 1033 "This update will not install or remove audio drivers."
LangString VoxBridgeAttribution 2052 "VB-CABLE 由 VB-Audio 提供 · 捐赠软件 · www.vb-cable.com"
LangString VoxBridgeAttribution 1033 "VB-CABLE by VB-Audio · Donationware · www.vb-cable.com"
LangString VoxBridgeDriverProgress 2052 "正在打开官方虚拟麦克风安装器，请完成驱动窗口中的操作…"
LangString VoxBridgeDriverProgress 1033 "Opening the official virtual microphone installer. Complete the steps in its window…"
LangString VoxBridgeFinishTitle 2052 "VoxBridge 已准备就绪"
LangString VoxBridgeFinishTitle 1033 "VoxBridge is ready"
LangString VoxBridgeFinishText 2052 "应用已安装完成。你可以从开始菜单搜索 VoxBridge 并打开。$\r$\n$\r$\n首次使用时，请在设置中配置模型服务。$\r$\n$\r$\n虚拟麦克风可稍后通过开始菜单中的驱动管理器安装或卸载。"
LangString VoxBridgeFinishText 1033 "Installation is complete. Search for VoxBridge in the Start menu to open it.$\r$\n$\r$\nFor your first session, configure your model services in Settings.$\r$\n$\r$\nThe virtual microphone can be installed or removed later from the Start menu driver manager."
LangString VoxBridgeRun 2052 "打开 VoxBridge"
LangString VoxBridgeRun 1033 "Open VoxBridge"

; The Start menu folder is a product default, not a decision every user needs.
!macroundef MUI_PAGE_STARTMENU
!macro MUI_PAGE_STARTMENU ID VAR
  !insertmacro MUI_PAGE_INIT
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE VoxBridgeDefaultStartMenu
  !insertmacro MUI_PAGEDECLARATION_STARTMENU "${ID}" "${VAR}"
  Function VoxBridgeDefaultStartMenu
    StrCpy "${VAR}" "VoxBridge"
    Abort
  FunctionEnd
!macroend

; Reuse the app-rendered setup shell for interactive uninstall. Silent updates
; never open UI; the original NSIS engine still owns file/data removal.
!macroundef MUI_UNPAGE_CONFIRM
!macro MUI_UNPAGE_CONFIRM
  !insertmacro MUI_UNPAGE_INIT
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE un.VoxBridgeOpenUninstallUI
  !insertmacro MUI_PAGEDECLARATION_CONFIRM
  Function un.VoxBridgeOpenUninstallUI
    ${If} $UpdateMode = 1
    ${OrIf} $PassiveMode = 1
      Abort
    ${EndIf}
    InitPluginsDir
    ClearErrors
    CopyFiles /SILENT "$INSTDIR\voxbridge.exe" "$PLUGINSDIR\voxbridge-uninstall-ui.exe"
    CopyFiles /SILENT "$EXEPATH" "$PLUGINSDIR\uninstall-payload.exe"
    ${IfNot} ${Errors}
      ExecWait '"$PLUGINSDIR\voxbridge-uninstall-ui.exe" --voxbridge-uninstall "--voxbridge-uninstall-root=$INSTDIR"' $0
      ${IfNot} ${Errors}
        SetErrorLevel $0
        Quit
      ${EndIf}
    ${EndIf}
    ; Copy/start failures leave the native recovery UI available.
  FunctionEnd
!macroend

!macroundef MUI_PAGE_INSTFILES
!macro MUI_PAGE_INSTFILES
  Page custom VoxBridgeReadyShow VoxBridgeReadyLeave
  !insertmacro MUI_PAGE_INIT
  !insertmacro MUI_PAGEDECLARATION_INSTFILES
  !insertmacro VOXBRIDGE_THEME_FUNCTIONS ""
  !insertmacro VOXBRIDGE_THEME_FUNCTIONS "un."

  ; Deferred until Tauri's UpdateMode and PassiveMode variables are declared.
  Function VoxBridgeInitializeUI
    StrCpy $VoxBridgeDriverChoice 0
    StrCpy $VoxBridgeWelcomeText "$(VoxBridgeWelcomeFresh)"
    ${If} $UpdateMode = 1
      StrCpy $VoxBridgeWelcomeText "$(VoxBridgeWelcomeUpdate)"
    ${EndIf}
    CreateFont $VoxBridgeSectionFont "$(^Font)" "9" "600"
    Call VoxBridgeThemePage
  FunctionEnd

  Function VoxBridgeReadyShow
    ${If} $PassiveMode = 1
    ${OrIf} ${Silent}
      Abort
    ${EndIf}
    ${If} $UpdateMode = 1
      !insertmacro MUI_HEADER_TEXT "$(VoxBridgeUpdateTitle)" "$(VoxBridgeReadySubtitle)"
    ${Else}
      !insertmacro MUI_HEADER_TEXT "$(VoxBridgeReadyTitle)" "$(VoxBridgeReadySubtitle)"
    ${EndIf}
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 20u "$(VoxBridgeKeepSettings)"
    Pop $0
    ${NSD_CreateLabel} 0 26u 100% 12u "$(VoxBridgeInstallFolder)"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $VoxBridgeSectionFont 1
    ${NSD_CreateText} 0 40u 100% 15u "$INSTDIR"
    Pop $0
    SendMessage $0 ${EM_SETREADONLY} 1 0
    ${NSD_CreateLabel} 0 66u 100% 12u "$(VoxBridgeMicrophone)"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $VoxBridgeSectionFont 1
    StrCpy $VoxBridgeDriverCheckbox ""
    ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Services\VBAudioVACMME" "ImagePath"
    ${If} $0 != ""
      ${NSD_CreateLabel} 0 84u 100% 14u "$(VoxBridgeDriverInstalled)"
      Pop $0
      ${NSD_CreateLabel} 0 100u 100% 23u "$(VoxBridgeDriverLater)"
      Pop $0
    ${ElseIf} $UpdateMode = 1
      ${NSD_CreateLabel} 0 84u 100% 14u "$(VoxBridgeDriverUnchanged)"
      Pop $0
      ${NSD_CreateLabel} 0 100u 100% 23u "$(VoxBridgeDriverLater)"
      Pop $0
    ${Else}
      ${NSD_CreateCheckbox} 0 84u 100% 14u "$(VoxBridgeDriverOption)"
      Pop $VoxBridgeDriverCheckbox
      ${NSD_SetState} $VoxBridgeDriverCheckbox $VoxBridgeDriverChoice
      ${NSD_CreateLabel} 0 100u 100% 23u "$(VoxBridgeDriverHelp)"
      Pop $0
    ${EndIf}
    ${NSD_CreateLabel} 0 126u 100% 12u "$(VoxBridgeAttribution)"
    Pop $0
    Call VoxBridgeThemePage
    nsDialogs::Show
  FunctionEnd

  Function VoxBridgeReadyLeave
    ${If} $VoxBridgeDriverCheckbox != ""
      ${NSD_GetState} $VoxBridgeDriverCheckbox $VoxBridgeDriverChoice
    ${EndIf}
  FunctionEnd
!macroend
