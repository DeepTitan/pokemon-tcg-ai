; Trace's Windows capture route must never outlive the application. Run the
; built-in recovery mode around installs, updates, and removals so even an old
; version that crashed before cleanup cannot leave PTCGL pointed at localhost.

!macro TRACE_CLEAN_CAPTURE_ROUTE
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 +2
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --trace-route-cleanup'
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro TRACE_CLEAN_CAPTURE_ROUTE
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro TRACE_CLEAN_CAPTURE_ROUTE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro TRACE_CLEAN_CAPTURE_ROUTE
!macroend
