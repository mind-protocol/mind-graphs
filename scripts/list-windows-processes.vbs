Option Explicit

Dim outputPath, wmi, processes, process, json, separator, stream

If WScript.Arguments.Count <> 1 Then
  WScript.Quit 64
End If

outputPath = WScript.Arguments(0)
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set processes = wmi.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process")

json = "["
separator = ""
For Each process In processes
  json = json & separator & "{""ProcessId"":" & process.ProcessId _
    & ",""CommandLine"":" & JsonString(process.CommandLine) & "}"
  separator = ","
Next
json = json & "]"

Set stream = CreateObject("ADODB.Stream")
stream.Type = 2
stream.Charset = "utf-8"
stream.Open
stream.WriteText json
stream.SaveToFile outputPath, 2
stream.Close

Function JsonString(value)
  Dim text
  If IsNull(value) Then
    text = ""
  Else
    text = CStr(value)
  End If
  text = Replace(text, "\", "\\")
  text = Replace(text, Chr(34), "\" & Chr(34))
  text = Replace(text, vbCr, "\r")
  text = Replace(text, vbLf, "\n")
  text = Replace(text, vbTab, "\t")
  JsonString = Chr(34) & text & Chr(34)
End Function
