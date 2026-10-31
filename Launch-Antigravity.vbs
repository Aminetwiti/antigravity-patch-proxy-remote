Set WshShell = CreateObject("WScript.Shell")
strCurDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strCurDir
WshShell.Run Chr(34) & strCurDir & "\Launch-Antigravity.bat" & Chr(34), 0, False
