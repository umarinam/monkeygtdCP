Option Explicit

Private Const SEND_TASK_PY As String = "D:\Personal\Projects\MonkeyGTD\monkeygtd-copilot\scripts\send-task.py"
Private Const DEFAULT_PARENT_TASK_ID As String = "8bkrfy3mr57q25y"

Public Sub SendSelectedEmailToMonkeyTask()
	On Error GoTo EH

	Dim mail As Outlook.MailItem
	Set mail = GetSelectedMailItem()
	If mail Is Nothing Then Exit Sub

	Dim parentTaskId As String
	parentTaskId = Trim$(DEFAULT_PARENT_TASK_ID)
	If parentTaskId = "" Then
		parentTaskId = Trim$(InputBox("Enter Parent Task ID:", "MonkeyGTD Parent Task"))
	End If
	If parentTaskId = "" Then Exit Sub

	Dim content As String
	content = BuildTaskContent(mail)

	RunSendTaskPython parentTaskId, content

	MsgBox "Email queued to MonkeyGTD.", vbInformation
	Exit Sub

EH:
	MsgBox "Error: " & Err.Description, vbCritical
End Sub

Private Function GetSelectedMailItem() As Outlook.MailItem
	Dim exp As Outlook.Explorer
	Dim sel As Outlook.Selection
	Dim it As Object

	Set exp = Application.ActiveExplorer
	If exp Is Nothing Then
		MsgBox "No active Outlook explorer window.", vbExclamation
		Set GetSelectedMailItem = Nothing
		Exit Function
	End If

	Set sel = exp.Selection
	If sel Is Nothing Or sel.Count = 0 Then
		MsgBox "Please select one email first.", vbExclamation
		Set GetSelectedMailItem = Nothing
		Exit Function
	End If

	Set it = sel.Item(1)
	If TypeName(it) <> "MailItem" Then
		MsgBox "Selected item is not an email.", vbExclamation
		Set GetSelectedMailItem = Nothing
		Exit Function
	End If

	Set GetSelectedMailItem = it
End Function

Private Function BuildTaskContent(ByVal mail As Outlook.MailItem) As String
	Dim subjectText As String
	Dim entryId As String

	subjectText = Trim$(mail.Subject)
	If subjectText = "" Then subjectText = "(No subject)"

	entryId = Trim$(mail.EntryID)
	BuildTaskContent = subjectText & " [fa:envelope](outlook:" & entryId & ")"
End Function

Private Sub RunSendTaskPython(ByVal parentTaskId As String, ByVal content As String)
	If Dir$(SEND_TASK_PY) = "" Then
		Err.Raise vbObjectError + 1001, , "Script not found: " & SEND_TASK_PY
	End If

	parentTaskId = Replace(parentTaskId, """", "")
	content = Replace(content, """", "'")

	Dim cmd As String
	cmd = "py -3 " & Q(SEND_TASK_PY) & " " & Q(parentTaskId) & " " & Q(content)

	Dim sh As Object
	Dim exitCode As Long
	Set sh = CreateObject("WScript.Shell")
	exitCode = sh.Run(cmd, 0, True)

	If exitCode <> 0 Then
		Err.Raise vbObjectError + 1002, , "send-task.py failed with exit code " & CStr(exitCode)
	End If
End Sub

Private Function Q(ByVal s As String) As String
	Q = """" & s & """"
End Function

