# Auto-update script for Gwen Sales Agent
# Location: G:\My Drive\gwen-sales-upgrade\auto-update.ps1

$repoPath = "G:\My Drive\gwen-sales-upgrade"
$lockFile = "$repoPath\.git\index.lock"
$logFile = "$repoPath\update-log.txt"

# Function to write logs
function Write-Log {
    param($message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp - $message" | Out-File -FilePath $logFile -Append
    Write-Host $message
}

Write-Log "=== Starting Gwen auto-update process ==="

# Navigate to repository
Set-Location $repoPath

# Remove index.lock if it exists (bulletproof fix)
if (Test-Path $lockFile) {
    Write-Log "WARNING: Found index.lock file, removing it..."
    Remove-Item -Path $lockFile -Force
    Start-Sleep -Seconds 2
}

# Pull latest changes first (prevents conflicts)
Write-Log "Pulling latest changes from remote..."
git pull origin main 2>&1 | Out-File -FilePath $logFile -Append

# Add all changes
Write-Log "Adding all changes..."
git add . 2>&1 | Out-File -FilePath $logFile -Append

# Check if there are changes to commit
$status = git status --porcelain
if ($status) {
    # Create commit with today's date
    $commitDate = Get-Date -Format "dd.MM.yyyy HH:mm"
    Write-Log "Committing changes with date: $commitDate"
    git commit -m "update $commitDate" 2>&1 | Out-File -FilePath $logFile -Append
    
    # Push to remote (standard push)
    Write-Log "Pushing to GitHub..."
    git push origin main 2>&1 | Out-File -FilePath $logFile -Append
    
    Write-Log "SUCCESS: Gwen updated and pushed to GitHub/Heroku"
} else {
    Write-Log "No changes detected - skipping commit"
}

Write-Log "=== Gwen auto-update process completed ===`n"