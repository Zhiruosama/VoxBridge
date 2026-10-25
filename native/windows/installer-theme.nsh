; Use the app's neutral palette throughout the native wizard, including its
; upstream pages. Keep native controls for keyboard and screen-reader support.
!define MUI_BGCOLOR "1E1E1E"
!define MUI_TEXTCOLOR "ECECEE"
!define MUI_DIRECTORYPAGE_TEXTCOLOR "ECECEE"
!define MUI_DIRECTORYPAGE_BGCOLOR "252525"
InstallColors ECECEE 252525

Var VoxBridgeThemeInitialized

; Preserve Tauri's callbacks, particularly uninstall data-retention controls.
!macroundef MUI_PAGE_FUNCTION_CUSTOM
!macro MUI_PAGE_FUNCTION_CUSTOM TYPE
  !ifdef MUI_PAGE_CUSTOMFUNCTION_${TYPE}
    Call "${MUI_PAGE_CUSTOMFUNCTION_${TYPE}}"
    !undef MUI_PAGE_CUSTOMFUNCTION_${TYPE}
  !endif
  !if "${TYPE}" == "SHOW"
    Call ${MUI_PAGE_UNINSTALLER_FUNCPREFIX}VoxBridgeThemePage
  !endif
!macroend

; Tauri's maintenance page is nsDialogs-based rather than a MUI page. Style
; controls as they are added, without replacing its update/uninstall logic.
!macro VoxBridgeCreateControl TYPE X Y W H TEXT
  nsDialogs::CreateControl ${__NSD_${TYPE}_CLASS} ${__NSD_${TYPE}_STYLE} ${__NSD_${TYPE}_EXSTYLE} ${X} ${Y} ${W} ${H} "${TEXT}"
  Call ${MUI_PAGE_UNINSTALLER_FUNCPREFIX}VoxBridgeThemePage
!macroend
!undef NSD_CreateLabel
!define NSD_CreateLabel '!insertmacro VoxBridgeCreateControl Label'
!undef NSD_CreateRadioButton
!define NSD_CreateRadioButton '!insertmacro VoxBridgeCreateControl RadioButton'
!undef NSD_CreateCheckbox
!define NSD_CreateCheckbox '!insertmacro VoxBridgeCreateControl CheckBox'

!macro VOXBRIDGE_THEME_FUNCTIONS PREFIX
  Function ${PREFIX}VoxBridgeThemePage
    Push $0
    Push $1
    Push $2
    Push $3
    ${If} $VoxBridgeThemeInitialized != 1
      StrCpy $VoxBridgeThemeInitialized 1
      ; The title-bar attribute is optional on older Windows builds.
      System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'
      ; Prefer native dark button/checkbox rendering on modern Windows. Resolve
      ; this optional OS export at runtime; older systems retain native controls.
      ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
      ${If} $0 >= 18362
        System::Call 'kernel32::LoadLibraryW(w "uxtheme.dll") p.r0'
        ${If} $0 <> 0
          System::Call 'kernel32::GetProcAddress(p r0, p 135) p.r1'
          ${If} $1 <> 0
            System::Call '::$1(i 2) i.r2'
          ${EndIf}
          System::Call 'kernel32::FreeLibrary(p r0)'
        ${EndIf}
      ${EndIf}
    ${EndIf}
    SetCtlColors $HWNDPARENT ECECEE 181818
    System::Call 'user32::GetWindow(p $HWNDPARENT, i 5) p.r0'
    ${DoWhile} $0 <> 0
      System::Call 'user32::GetClassNameW(p r0, w.r2, i 256)'
      ${If} $2 == "Edit"
      ${OrIf} $2 == "SysListView32"
        SetCtlColors $0 ECECEE 252525
      ${Else}
        SetCtlColors $0 ECECEE 1E1E1E
      ${EndIf}
      ${If} $2 == "Edit"
        ; Flat fields match the app; native client-edge borders render white.
        System::Call 'user32::GetWindowLongW(p r0, i -16) i.r3'
        IntOp $3 $3 & 0xFF7FFFFF
        System::Call 'user32::SetWindowLongW(p r0, i -16, i r3)'
        System::Call 'user32::GetWindowLongW(p r0, i -20) i.r3'
        IntOp $3 $3 & 0xFFFFFDFF
        System::Call 'user32::SetWindowLongW(p r0, i -20, i r3)'
        System::Call 'user32::SetWindowPos(p r0, p 0, i 0, i 0, i 0, i 0, i 55)'
      ${EndIf}
      ${If} $2 == "Button"
      ${OrIf} $2 == "Edit"
      ${OrIf} $2 == "SysListView32"
        System::Call 'uxtheme::SetWindowTheme(p r0, w "DarkMode_Explorer", p 0)'
      ${EndIf}
      ${If} $2 == "Button"
        System::Call 'user32::GetWindowLongW(p r0, i -16) i.r3'
        IntOp $3 $3 & 15
        ${If} $3 = 7
          ; The themed group-box caption otherwise stays black in dark mode.
          System::Call 'uxtheme::SetWindowTheme(p r0, w "", w "")'
          SetCtlColors $0 ECECEE 1E1E1E
        ${EndIf}
      ${ElseIf} $2 == "Static"
        System::Call 'user32::GetWindowLongW(p r0, i -16) i.r3'
        IntOp $3 $3 & 31
        ${If} $3 = 16
        ${OrIf} $3 = 17
          ShowWindow $0 0
        ${EndIf}
      ${EndIf}
      System::Call 'user32::GetWindow(p r0, i 5) p.r1'
      ${If} $1 <> 0
        StrCpy $0 $1
      ${Else}
        ${Do}
          System::Call 'user32::GetWindow(p r0, i 2) p.r1'
          ${If} $1 <> 0
            StrCpy $0 $1
            ${ExitDo}
          ${EndIf}
          System::Call 'user32::GetParent(p r0) p.r0'
          ${If} $0 = $HWNDPARENT
          ${OrIf} $0 = 0
            StrCpy $0 0
            ${ExitDo}
          ${EndIf}
        ${Loop}
      ${EndIf}
    ${Loop}
    ; Replace the template's default third-party branding with the app name.
    GetDlgItem $0 $HWNDPARENT 1028
    ShowWindow $0 0
    GetDlgItem $0 $HWNDPARENT 1256
    ShowWindow $0 0
    GetDlgItem $0 $HWNDPARENT 1034
    SendMessage $0 ${WM_SETTEXT} 0 "STR:VoxBridge"
    SetCtlColors $0 A4A4AE 181818
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd
!macroend
