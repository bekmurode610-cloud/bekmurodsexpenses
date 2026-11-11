$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '//B //nologo "d:\ADMIN VAJNO\Downloads\telegram-expense-bot\scripts\silent_run.vbs"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'TelegramDutyCron' -Action $action -Trigger $trigger -Description 'Automated Telegram Bot Duty Reminder' -Force


