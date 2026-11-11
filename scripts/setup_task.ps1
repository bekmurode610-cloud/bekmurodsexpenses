$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "d:\ADMIN VAJNO\Downloads\telegram-expense-bot\scripts\run_duty_cron.ps1"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'TelegramDutyCron' -Action $action -Trigger $trigger -Description 'Automated Telegram Bot Duty Reminder' -Force

