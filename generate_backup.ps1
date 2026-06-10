# Generate Chat Backup script with UTF-8 BOM encoding and automated secrets redaction
$transcriptPath = "C:\Users\mihir\.gemini\antigravity\brain\1f7982f1-18a9-4229-8750-7734df171f26\.system_generated\logs\transcript.jsonl"
$outputPath = "C:\Users\mihir\OneDrive\Desktop\personal-cloud-drive\chat_backup.md"

if (-not (Test-Path $transcriptPath)) {
    Write-Error "Transcript file not found at $transcriptPath"
    exit
}

$markdown = @"
# 💾 AURA's Private Locker - Chat Backup

*Backup generated on: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")*
*This file contains the complete chronological conversation history between the User and Antigravity (AURA).*
*Note: Any sensitive Google API credentials (Client ID, Client Secret, Refresh Token) have been automatically redacted for security.*

---

"@

# Read all lines with UTF8 encoding
$lines = [System.IO.File]::ReadAllLines($transcriptPath, [System.Text.Encoding]::UTF8)

foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try {
        $json = ConvertFrom-Json $line
        $timestamp = $json.created_at
        $formattedTime = "Unknown Time"
        if ($timestamp) {
            $parsedDate = [DateTime]::Parse($timestamp)
            $formattedTime = $parsedDate.ToString("yyyy-MM-dd HH:mm:ss")
        }

        if ($json.type -eq "USER_INPUT") {
            $rawContent = $json.content
            $userMsg = ""
            if ($rawContent -match "(?s)<USER_REQUEST>(.*?)</USER_REQUEST>") {
                $userMsg = $Matches[1].Trim()
            } else {
                $userMsg = $rawContent.Trim()
            }

            if (-not [string]::IsNullOrWhiteSpace($userMsg)) {
                $markdown += "`n### 👤 User ($formattedTime)`n`n"
                $markdown += "> $userMsg`n`n"
                $markdown += "---`n"
            }
        }
        elseif ($json.type -eq "PLANNER_RESPONSE") {
            $assistantMsg = $json.content
            if ($assistantMsg -and -not [string]::IsNullOrWhiteSpace($assistantMsg)) {
                $markdown += "`n### 🤖 AURA Assistant ($formattedTime)`n`n"
                $markdown += "$($assistantMsg.Trim())`n`n"
                $markdown += "---`n"
            }
        }
    } catch {
        # Skip invalid JSON lines silently
    }
}

# Apply regex replacements to redact sensitive Google credentials from the entire markdown text
$markdown = $markdown -replace '(?i)[0-9a-zA-Z_-]+\.apps\.googleusercontent\.com', '[REDACTED_CLIENT_ID].apps.googleusercontent.com'
$markdown = $markdown -replace '(?i)GOCSPX-[0-9a-zA-Z_-]{20,40}', 'GOCSPX-[REDACTED_CLIENT_SECRET]'
$markdown = $markdown -replace '(?i)1//[0-9a-zA-Z_-]{20,200}', '1//[REDACTED_REFRESH_TOKEN]'

# Write with standard UTF-8 (which has BOM)
[System.IO.File]::WriteAllText($outputPath, $markdown, [System.Text.Encoding]::UTF8)
Write-Host "Backup generated successfully (with secrets redacted) at $outputPath"
