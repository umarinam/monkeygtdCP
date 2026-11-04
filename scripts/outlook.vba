Option Explicit

Private Const SEND_TASK_PY As String = "D:\Personal\Projects\MonkeyGTD\monkeygtd-copilot\scripts\send-task.py"
' Empty files emails into the "Inbox" list; set a task id to file them under that task instead.
Private Const PARENT_TASK_ID As String = ""
Private Const MAX_ERROR_CHARS As Long = 300

Public Sub SendSelectedEmailToMonkeyTask()
	On Error GoTo EH

	If Dir$(SEND_TASK_PY) = "" Then
		MsgBox "Script not found: " & SEND_TASK_PY, vbCritical
		Exit Sub
	End If

	Dim exp As Outlook.Explorer
	Set exp = Application.ActiveExplorer
	If exp Is Nothing Then
		MsgBox "No active Outlook explorer window.", vbExclamation
		Exit Sub
	End If

	Dim sel As Outlook.Selection
	Set sel = exp.Selection
	If sel.Count = 0 Then
		MsgBox "Please select at least one email first.", vbExclamation
		Exit Sub
	End If

	Dim it As Object
	Dim mailCount As Long
	Dim queuedCount As Long
	Dim skippedCount As Long
	Dim failures As String
	Dim errorText As String

	For Each it In sel
		If TypeName(it) = "MailItem" Then
			mailCount = mailCount + 1
			errorText = RunSendTask(BuildTaskContent(it))
			If errorText = "" Then
				queuedCount = queuedCount + 1
			Else
				failures = failures & vbCrLf & "- " & SubjectOf(it) & ": " & errorText
			End If
		Else
			skippedCount = skippedCount + 1
		End If
	Next

	ShowSummary mailCount, queuedCount, skippedCount, failures
	Exit Sub

EH:
	MsgBox "Error: " & Err.Description, vbCritical
End Sub

Private Function SubjectOf(ByVal mail As Outlook.MailItem) As String
	Dim subjectText As String
	subjectText = Trim$(mail.Subject)
	If subjectText = "" Then subjectText = "(No subject)"
	SubjectOf = subjectText
End Function

Private Function BuildTaskContent(ByVal mail As Outlook.MailItem) As String
	BuildTaskContent = SubjectOf(mail) & " [fa:envelope](outlook:" & Trim$(mail.EntryID) & ")"
End Function

Private Function TargetLabel() As String
	If PARENT_TASK_ID = "" Then
		TargetLabel = "the MonkeyGTD Inbox"
	Else
		TargetLabel = "MonkeyGTD task " & PARENT_TASK_ID
	End If
End Function

' Returns "" on success, otherwise the script's error output.
Private Function RunSendTask(ByVal content As String) As String
	Dim targetArgs As String
	If PARENT_TASK_ID = "" Then
		targetArgs = "--inbox --source outlook -- "
	Else
		targetArgs = "--source outlook -- " & Q(PARENT_TASK_ID) & " "
	End If

	Dim logPath As String
	logPath = Environ$("TEMP") & "\monkeygtd-outlook.log"

	' "--" keeps a subject that starts with "-" from being read as an option.
	Dim cmd As String
	cmd = "py -3 " & Q(SEND_TASK_PY) & " " & targetArgs & Q(Replace(content, """", "'"))

	' Run hidden through cmd so the script's output can be captured for the summary.
	Dim exitCode As Long
	exitCode = CreateObject("WScript.Shell").Run("cmd /s /c """ & cmd & " > " & Q(logPath) & " 2>&1""", 0, True)

	Dim scriptOutput As String
	scriptOutput = ReadTextFile(logPath)
	If Dir$(logPath) <> "" Then Kill logPath

	If exitCode = 0 Then Exit Function

	scriptOutput = Trim$(Replace(Replace(scriptOutput, vbCr, ""), vbLf, " "))
	If scriptOutput = "" Then scriptOutput = "send-task.py failed with exit code " & CStr(exitCode)
	' Keep the tail: argparse puts the actual error after a long usage line.
	If Len(scriptOutput) > MAX_ERROR_CHARS Then scriptOutput = "..." & Right$(scriptOutput, MAX_ERROR_CHARS)
	RunSendTask = scriptOutput
End Function

Private Function ReadTextFile(ByVal filePath As String) As String
	If Dir$(filePath) = "" Then Exit Function
	If FileLen(filePath) = 0 Then Exit Function

	Dim fileText As String
	Dim f As Integer
	f = FreeFile
	Open filePath For Binary Access Read As #f
	fileText = Space$(LOF(f))
	Get #f, , fileText
	Close #f
	ReadTextFile = fileText
End Function

Private Sub ShowSummary(ByVal mailCount As Long, ByVal queuedCount As Long, ByVal skippedCount As Long, ByVal failures As String)
	If mailCount = 0 Then
		MsgBox "The selection has no emails.", vbExclamation
		Exit Sub
	End If

	Dim msg As String
	If failures = "" Then
		msg = "Queued " & queuedCount & IIf(queuedCount = 1, " email", " emails") & " to " & TargetLabel() & "."
	Else
		msg = "Queued " & queuedCount & " of " & mailCount & " emails to " & TargetLabel() & "."
	End If
	If skippedCount > 0 Then msg = msg & vbCrLf & "Skipped " & skippedCount & " selected item(s) that are not emails."

	If failures = "" Then
		MsgBox msg, vbInformation
	Else
		MsgBox msg & vbCrLf & vbCrLf & "Failed:" & failures, vbExclamation
	End If
End Sub

Private Function Q(ByVal s As String) As String
	Q = """" & s & """"
End Function
