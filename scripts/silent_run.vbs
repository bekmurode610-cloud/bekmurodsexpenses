Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""d:\ADMIN VAJNO\Downloads\telegram-expense-bot\scripts\run_duty_cron.ps1""", 0, False
