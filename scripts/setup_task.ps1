$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '//B //nologo "d:\ADMIN VAJNO\Downloads\telegram-expense-bot\scripts\silent_run.vbs"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances Parallel -Priority 4
Register-ScheduledTask -TaskName 'TelegramDutyCron' -Action $action -Trigger $trigger -Settings $settings -Description 'Automated Telegram Bot Duty Reminder & Auto-Delete Sweeper' -Force



