' Create or update a Windows shortcut (idempotent - re-running overwrites the
' SAME .lnk, never creates "DeepSeek Harness (1)"). Pure COM helper called by
' scripts/install-desktop.mjs; keeps PowerShell out of the product flow.
' Args: 0=lnkPath 1=targetPath 2=arguments 3=workingDir 4=iconLocation 5=description
' NOTE: arg(2) is a RAW path; the quotes are added HERE so the stored shortcut
' Arguments read  "C:\...\launch-hidden.vbs"  (with quotes) - required when the
' path ever contains spaces, and NOT mangled by command-line re-quoting.
Option Explicit
Dim ws, lnk
Set ws = CreateObject("WScript.Shell")
Set lnk = ws.CreateShortcut(WScript.Arguments(0))
lnk.TargetPath = WScript.Arguments(1)
lnk.Arguments = """" & WScript.Arguments(2) & """"
lnk.WorkingDirectory = WScript.Arguments(3)
lnk.IconLocation = WScript.Arguments(4)
lnk.Description = WScript.Arguments(5)
lnk.Save
