const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT_PATH = path.resolve(__dirname, '../scripts/backup/backup.example.ps1');
const REHEARSAL_PATH = path.resolve(__dirname, '../scripts/backup/restore-rehearsal.example.ps1');

// Helper to create mock binary directory
async function setupMocks(tempDir) {
  const mockBinDir = path.join(tempDir, 'mock_bin');
  await fsp.mkdir(mockBinDir, { recursive: true });

  // pg_dump mock: writes dummy content to the file specified in --file
  const pgDumpContent = `@echo off
shift
:loop
if "%~1"=="" goto end
echo %~1 | findstr /r "^--file=" >nul
if errorlevel 0 (
    set arg=%~1
    call :writefile
)
shift
goto loop
:end
exit /b 0

:writefile
set filepath=%arg:--file=%
set filepath=%filepath:~1%
echo MOCK DUMP CONTENT > "%filepath%"
exit /b 0
`;
  await fsp.writeFile(path.join(mockBinDir, 'pg_dump.cmd'), pgDumpContent);

  // gpg mock: writes dummy content to the file specified in --output
  const gpgContent = `@echo off
shift
:loop
if "%~1"=="" goto end
if "%~1"=="--output" (
    echo MOCK ENCRYPTED CONTENT > "%~2"
    goto end
  )
shift
goto loop
:end
exit /b 0
`;
  await fsp.writeFile(path.join(mockBinDir, 'gpg.cmd'), gpgContent);

  // pg_restore mock: exits successfully
  await fsp.writeFile(path.join(mockBinDir, 'pg_restore.cmd'), '@echo off\nexit /b 0\n');

  return mockBinDir;
}

test('backup template fails closed when required variables are missing', async () => {
  const result = spawnSync('powershell.exe', [
    '-ExecutionPolicy', 'Bypass',
    '-File', SCRIPT_PATH
  ], {
    env: {
      ...process.env,
      BACKUP_DIRECTORY_PLACEHOLDER: '', // Missing
    },
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /CRITICAL: Backup configuration variables are missing/);
});

test('backup template never echoes database password or connection parameters', async () => {
  const tempDir = path.join(__dirname, 'temp_backup_test_secrets');
  await fsp.mkdir(tempDir, { recursive: true });

  try {
    const mockBinDir = await setupMocks(tempDir);
    const mockKeyFile = path.join(tempDir, 'key.txt');
    await fsp.writeFile(mockKeyFile, 'dummy_key');

    const mockNasDir = path.join(tempDir, 'mock_nas');
    await fsp.mkdir(mockNasDir, { recursive: true });

    const localBackupDir = path.join(tempDir, 'local_backup');
    await fsp.mkdir(localBackupDir, { recursive: true });

    const secretPassword = 'SUPER_SECRET_PASSWORD_123_DO_NOT_ECHO';
    const secretHost = 'SECRET_DB_HOST_XYZ.database.windows.net';

    const result = spawnSync('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-Command', `function Get-FileHash { param($Path, $Algorithm); return [PSCustomObject]@{ Hash = 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2' } }; & '${SCRIPT_PATH.replace(/\\/g, '\\\\')}'`
    ], {
      env: {
        ...process.env,
        PATH: `${mockBinDir};${process.env.PATH}`,
        BACKUP_DIRECTORY_PLACEHOLDER: localBackupDir,
        DATABASE_HOST_PLACEHOLDER: secretHost,
        DATABASE_USER_PLACEHOLDER: 'db_user_placeholder',
        DATABASE_PASSWORD_PLACEHOLDER: secretPassword,
        DATABASE_NAME_PLACEHOLDER: 'db_name_placeholder',
        BACKUP_ENCRYPTION_KEY_FILE_PLACEHOLDER: mockKeyFile,
        NAS_DESTINATION_DIR_PLACEHOLDER: mockNasDir
      },
      encoding: 'utf8'
    });

    const output = (result.stdout || '') + (result.stderr || '');
    assert.equal(output.includes(secretPassword), false, 'Should not contain the secret password');
    assert.equal(output.includes(secretHost), false, 'Should not contain the database host connection string');
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test('backup template runs successfully and cleans up temp files in mock scenario', async () => {
  const tempDir = path.join(__dirname, 'temp_backup_test_success');
  await fsp.mkdir(tempDir, { recursive: true });

  try {
    const mockBinDir = await setupMocks(tempDir);
    const mockKeyFile = path.join(tempDir, 'key.txt');
    await fsp.writeFile(mockKeyFile, 'dummy_key');

    const mockNasDir = path.join(tempDir, 'mock_nas');
    await fsp.mkdir(mockNasDir, { recursive: true });

    const localBackupDir = path.join(tempDir, 'local_backup');
    await fsp.mkdir(localBackupDir, { recursive: true });

    const result = spawnSync('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-Command', `function Get-FileHash { param($Path, $Algorithm); return [PSCustomObject]@{ Hash = 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2' } }; & '${SCRIPT_PATH.replace(/\\/g, '\\\\')}'`
    ], {
      env: {
        ...process.env,
        PATH: `${mockBinDir};${process.env.PATH}`,
        BACKUP_DIRECTORY_PLACEHOLDER: localBackupDir,
        DATABASE_HOST_PLACEHOLDER: 'db_host_placeholder',
        DATABASE_USER_PLACEHOLDER: 'db_user_placeholder',
        DATABASE_PASSWORD_PLACEHOLDER: 'db_pass_placeholder',
        DATABASE_NAME_PLACEHOLDER: 'db_name_placeholder',
        BACKUP_ENCRYPTION_KEY_FILE_PLACEHOLDER: mockKeyFile,
        NAS_DESTINATION_DIR_PLACEHOLDER: mockNasDir
      },
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      console.error('STDOUT:', result.stdout);
      console.error('STDERR:', result.stderr);
      assert.equal(result.status, 0);
    }

    // Verify local temp files are deleted
    const localFiles = await fsp.readdir(localBackupDir);
    assert.deepEqual(localFiles.filter(f => f.endsWith('.dump') || f.endsWith('.dump.enc')), []);

    // Verify files were copied to NAS directory
    const nasFiles = await fsp.readdir(mockNasDir);
    assert.equal(nasFiles.some(f => f.endsWith('.dump.enc')), true, 'Should copy encrypted backup to NAS');
    assert.equal(nasFiles.some(f => f.endsWith('.dump.sha256')), true, 'Should copy checksum file to NAS');
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test('restore rehearsal template fails closed when required variables are missing', async () => {
  const result = spawnSync('powershell.exe', [
    '-ExecutionPolicy', 'Bypass',
    '-File', REHEARSAL_PATH
  ], {
    env: {
      ...process.env,
      REHEARSAL_DB_NAME_PLACEHOLDER: '', // Missing
    },
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0);
});
