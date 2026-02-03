Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Jakeb\mcp-servers\whatsapp"
WshShell.Run "cmd /c node claude-receptionist.js > receptionist-output.log 2>&1", 0, False
