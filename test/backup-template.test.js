const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT_PATH = path.resolve(__dirname, '../scripts/backup/backup.example.ps1');
const REHEARSAL_PATH = path.resolve(__dirname, '../scripts/backup/restore-rehearsal.example.ps1');
const POWERSHELL_COMMAND = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

// Helper to create mock binary directory
async function setupMocks(tempDir) {
  const mockBinDir = path.join(tempDir, 'mock_bin');
  await fsp.mkdir(mockBinDir, { recursive: true });

  // pg_dump mock: writes dummy content to the file specified in --file
  const pgDumpContent = `@echo off
setlocal EnableExtensions
:loop
if "%~1"=="" exit /b 0
if /i "%~1"=="--file" goto write_next
set "arg=%~1"
call :check_equals "%arg%"
if not errorlevel 1 exit /b 0
shift
goto loop

:write_next
shift
if "%~1"=="" exit /b 1
>"%~1" echo MOCK DUMP CONTENT
exit /b 0

:check_equals
set "candidate=%~1"
if /i not "%candidate:~0,7%"=="--file=" exit /b 1
set "filepath=%candidate:~7%"
>"%filepath%" echo MOCK DUMP CONTENT
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

  if (process.platform !== 'win32') {
    const portableMocks = {
      pg_dump: '#!/usr/bin/env sh\nset -eu\nfile=""\nfor arg in "$@"; do\n  case "$arg" in\n    --file=*) file="${arg#--file=}" ;;\n  esac\ndone\n[ -n "$file" ]\nprintf "%s\\n" "MOCK DUMP CONTENT" > "$file"\n',
      gpg: '#!/usr/bin/env sh\nset -eu\noutput=""\nprevious=""\nfor arg in "$@"; do\n  if [ "$previous" = "--output" ]; then output="$arg"; fi\n  previous="$arg"\ndone\n[ -n "$output" ]\nprintf "%s\\n" "MOCK ENCRYPTED CONTENT" > "$output"\n',
      pg_restore: '#!/usr/bin/env sh\nexit 0\n'
    };
    for (const [name, content] of Object.entries(portableMocks)) {
      const file = path.join(mockBinDir, name);
      await fsp.writeFile(file, content);
      await fsp.chmod(file, 0o755);
    }
  }

  return mockBinDir;
}

test('backup template fails closed when required variables are missing', async () => {
  const result = spawnSync(POWERSHELL_COMMAND, [
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

    const result = spawnSync(POWERSHELL_COMMAND, [
      '-ExecutionPolicy', 'Bypass',
      '-Command', `function Get-FileHash { param($Path, $Algorithm); return [PSCustomObject]@{ Hash = 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2' } }; & '${SCRIPT_PATH.replace(/\\/g, '\\\\')}'`
    ], {
      env: {
        ...process.env,
        PATH: `${mockBinDir}${path.delimiter}${process.env.PATH || ''}`,
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

    const result = spawnSync(POWERSHELL_COMMAND, [
      '-ExecutionPolicy', 'Bypass',
      '-Command', `function Get-FileHash { param($Path, $Algorithm); return [PSCustomObject]@{ Hash = 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2' } }; & '${SCRIPT_PATH.replace(/\\/g, '\\\\')}'`
    ], {
      env: {
        ...process.env,
        PATH: `${mockBinDir}${path.delimiter}${process.env.PATH || ''}`,
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
  const result = spawnSync(POWERSHELL_COMMAND, [
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
