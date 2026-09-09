; Trace's Windows capture route must never outlive the application. Run the
; built-in recovery mode around installs, updates, and removals so even an old
; version that crashed before cleanup cannot leave PTCGL pointed at localhost.

!include LogicLib.nsh

; A normal, user-opened installer must not replace Trace while TCG Live is
; running. The in-app updater uses passive mode and is already held by Trace
; until the active match ends, so it can continue without requiring the user to
; close the client after every game.
!macro TRACE_BLOCK_UNSAFE_MANUAL_INSTALL
  ${If} $PassiveMode != 1
    nsExec::ExecToStack 'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -Command "if (Get-Process -Name $\"Pokemon TCG Live$\" -ErrorAction SilentlyContinue) { exit 42 } else { exit 0 }"'
    Pop $0
    Pop $1
    ${If} $0 == 42
      MessageBox MB_OK|MB_ICONEXCLAMATION "Trace is protecting your game.$\r$\n$\r$\nFinish the current match and close TCG Live before installing or reinstalling Trace."
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro TRACE_CLEAN_CAPTURE_ROUTE
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 +2
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --trace-route-cleanup'
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro TRACE_BLOCK_UNSAFE_MANUAL_INSTALL
  !insertmacro TRACE_CLEAN_CAPTURE_ROUTE
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro TRACE_CLEAN_CAPTURE_ROUTE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro TRACE_CLEAN_CAPTURE_ROUTE
!macroend
