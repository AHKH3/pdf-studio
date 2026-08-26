; Scheduled background updates while the app is closed.
; electron-builder includes this via nsis.include (defaults to build/installer.nsh).
; APP_EXECUTABLE_FILENAME is defined in electron-builder's common.nsh.

!define PDFSTUDIO_TASK_PERIODIC "PDFStudioBackgroundUpdate"
!define PDFSTUDIO_TASK_LOGON "PDFStudioBackgroundUpdateLogon"

!macro customInstall
  FileOpen $0 "$INSTDIR\pdfstudio-bg-update.cmd" w
  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --background-update$\r$\n'
  FileClose $0
  nsExec::ExecToLog 'schtasks /Create /F /TN "${PDFSTUDIO_TASK_PERIODIC}" /TR "$INSTDIR\pdfstudio-bg-update.cmd" /SC HOURLY /MO 6 /RL LIMITED'
  nsExec::ExecToLog 'schtasks /Create /F /TN "${PDFSTUDIO_TASK_LOGON}" /TR "$INSTDIR\pdfstudio-bg-update.cmd" /SC ONLOGON /RL LIMITED /NP'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'schtasks /Delete /F /TN "${PDFSTUDIO_TASK_PERIODIC}"'
  nsExec::ExecToLog 'schtasks /Delete /F /TN "${PDFSTUDIO_TASK_LOGON}"'
  Delete "$INSTDIR\pdfstudio-bg-update.cmd"
!macroend
