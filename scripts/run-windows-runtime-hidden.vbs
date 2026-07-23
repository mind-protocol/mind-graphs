Option Explicit

Dim shell, fileSystem, scriptDirectory, projectDirectory
Dim serviceName, nodeExecutable, command, exitCode

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
projectDirectory = fileSystem.GetParentFolderName(scriptDirectory)

If WScript.Arguments.Count <> 1 Then
  WScript.Quit 64
End If

serviceName = LCase(WScript.Arguments(0))
nodeExecutable = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")

If Not fileSystem.FileExists(nodeExecutable) Then
  nodeExecutable = "node.exe"
End If

Select Case serviceName
  Case "api"
    command = Quote(nodeExecutable) & " " & Quote(projectDirectory & "\src\server.js")
  Case "autonomy"
    command = Quote(nodeExecutable) & " " & Quote(projectDirectory & "\scripts\autonomous-agent.js") & " --no-personal"
  Case "manager"
    command = Quote(nodeExecutable) & " " & Quote(projectDirectory & "\scripts\runtime-manager.js") & " --interval=15"
  Case Else
    WScript.Quit 64
End Select

shell.CurrentDirectory = projectDirectory
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function Quote(value)
  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
