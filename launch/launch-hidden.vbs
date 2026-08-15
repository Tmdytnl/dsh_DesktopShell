' DeepSeek Harness - hidden bootstrap (Productization v1).
' ONLY: resolve this folder, run desktop-launch.cmd in a HIDDEN window, exit.
' No waiting (Run ... 0, False), no PID checks, no supervision - lifecycle
' belongs to desktop-app + ctx.appExit (frozen). Startup failures are reported
' by desktop-launch.cmd itself (log + popup) and exit immediately.
Option Explicit
Dim fso, shell, cmdPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
cmdPath = fso.GetParentFolderName(WScript.ScriptFullName) & "\desktop-launch.cmd"
shell.Run """" & cmdPath & """", 0, False
