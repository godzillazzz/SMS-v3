# PowerShell Backup Script Template (Example Only)
# Milestone: Windows Server/NAS Backup Automation Readiness

$ErrorActionPreference = "Stop"

# Required configuration placeholders - must be configured on execution host
$BackupDir = $env:BACKUP_DIRECTORY_PLACEHOLDER
$DatabaseHost = $env:DATABASE_HOST_PLACEHOLDER
$DatabaseUser = $env:DATABASE_USER_PLACEHOLDER
$DatabasePassword = $env:DATABASE_PASSWORD_PLACEHOLDER
$DatabaseName = $env:DATABASE_NAME_PLACEHOLDER
$EncryptionKeyFile = $env:BACKUP_ENCRYPTION_KEY_FILE_PLACEHOLDER
$NasDestDirectory = $env:NAS_DESTINATION_DIR_PLACEHOLDER
$RetentionDays = 30

# Fail Closed: Validate that all required configuration variables are present
if (-not $BackupDir -or -not $DatabaseHost -or -not $DatabaseUser -or -not $DatabasePassword -or -not $DatabaseName -or -not $EncryptionKeyFile -or -not $NasDestDirectory) {
    Write-Error "CRITICAL: Backup configuration variables are missing. Failing closed."
    exit 1
}

$Timestamp = Get-Date -Format "yyyyMMddTHHmmss"
$BackupFile = Join-Path $BackupDir "smsv3-backup-$Timestamp.dump"
$EncryptedFile = "$BackupFile.enc"
$ChecksumFile = "$BackupFile.sha256"

try {
    # 1. Initiate Logical Dump
    Write-Output "Starting logical custom dump..."
    $env:PGPASSWORD = $DatabasePassword
    # Run pg_dump (shell-safe invoke pattern)
    & pg_dump --host=$DatabaseHost --port=5432 --username=$DatabaseUser --dbname=$DatabaseName --format=custom --schema=public --file=$BackupFile
    Remove-Item Env:\PGPASSWORD

    # 2. Generate Checksum
    Write-Output "Generating SHA-256 checksum..."
    $Checksum = (Get-FileHash -Algorithm SHA256 $BackupFile).Hash
    "$Checksum  $(Split-Path $BackupFile -Leaf)" | Out-File $ChecksumFile -Encoding utf8

    # 3. Encrypt File
    Write-Output "Encrypting backup dump..."
    # gpg encryption pattern (example symmetric key invocation)
    & gpg --symmetric --batch --yes --passphrase-file=$EncryptionKeyFile --cipher-algo AES256 --output $EncryptedFile $BackupFile
    Remove-Item $BackupFile

    # 4. Transfer to NAS storage
    Write-Output "Transferring to secure NAS directory..."
    Copy-Item $EncryptedFile $NasDestDirectory
    Copy-Item $ChecksumFile $NasDestDirectory
    
    # 5. Apply Retention Policy
    Write-Output "Applying retention policy..."
    $CutoffDate = (Get-Date).AddDays(-$RetentionDays)
    Get-ChildItem $NasDestDirectory -Filter "smsv3-backup-*.enc" | Where-Object { $_.LastWriteTime -lt $CutoffDate } | Remove-Item -Force
    Get-ChildItem $NasDestDirectory -Filter "smsv3-backup-*.sha256" | Where-Object { $_.LastWriteTime -lt $CutoffDate } | Remove-Item -Force

    Write-Output "Backup completed successfully."
} catch {
    Write-Error "Backup process failed: $_"
    # Ensure credentials are wiped
    if (Test-Path Env:\PGPASSWORD) { Remove-Item Env:\PGPASSWORD }
    # Clean up local partial files
    if (Test-Path $BackupFile) { Remove-Item $BackupFile -Force }
    if (Test-Path $EncryptedFile) { Remove-Item $EncryptedFile -Force }
    if (Test-Path $ChecksumFile) { Remove-Item $ChecksumFile -Force }
    exit 1
}
