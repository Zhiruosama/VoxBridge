!include LogicLib.nsh
; Fail closed before any shortcut, registry, app or credential removal. This
; also protects direct /S invocations, bypassing the React preflight.
!macro VOXBRIDGE_ASSERT_APP_STOPPED
  ${If} ${FileExists} "$INSTDIR\voxbridge.exe"
    ; An executable image or another open handle prevents exclusive write/delete
    ; access. Never ask Restart Manager to force-kill the user's live session.
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\voxbridge.exe", i 0xC0010000, i 0, p 0, i 3, i 0, p 0) p.r0'
    ${If} $0 = -1
    ${OrIf} $0 = 0
      SetErrorLevel 2
      Abort "VoxBridge is running or its files are in use. Quit the app and retry. Nothing has been removed."
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r0)'
  ${EndIf}
!macroend
