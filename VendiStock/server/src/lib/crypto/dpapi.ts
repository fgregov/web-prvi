import { execFile } from 'node:child_process';

/**
 * Windows DPAPI (System.Security.Cryptography.ProtectedData) preko PowerShella.
 * Podaci se prenose isključivo kroz stdin/stdout (nikad kroz argumente naredbenog retka),
 * pa se ne vide u popisu procesa.
 */
const ENTROPY_B64 = Buffer.from('VendiStock/v1/master-key').toString('base64');

function script(op: 'Protect' | 'Unprotect', scope: 'CurrentUser' | 'LocalMachine'): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Security',
    '$inp = [Console]::In.ReadToEnd().Trim()',
    '$bytes = [Convert]::FromBase64String($inp)',
    `$entropy = [Convert]::FromBase64String('${ENTROPY_B64}')`,
    `$scope = [System.Security.Cryptography.DataProtectionScope]::${scope}`,
    `$out = [System.Security.Cryptography.ProtectedData]::${op}($bytes, $entropy, $scope)`,
    '[Console]::Out.Write([Convert]::ToBase64String($out))',
  ].join('; ');
}

export type ExecFn = (
  file: string,
  args: string[],
  input: string,
) => Promise<{ stdout: string; stderr: string }>;

const defaultExec: ExecFn = (file, args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`DPAPI greška: ${stderr || err.message}`));
        else resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
    child.stdin?.end(input);
  });

export function powershellArgs(op: 'Protect' | 'Unprotect', scope: 'CurrentUser' | 'LocalMachine') {
  const encoded = Buffer.from(script(op, scope), 'utf16le').toString('base64');
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
}

export async function dpapiProtect(
  data: Buffer,
  scope: 'CurrentUser' | 'LocalMachine',
  exec: ExecFn = defaultExec,
): Promise<Buffer> {
  const { stdout } = await exec('powershell.exe', powershellArgs('Protect', scope), data.toString('base64'));
  return Buffer.from(stdout.trim(), 'base64');
}

export async function dpapiUnprotect(
  data: Buffer,
  scope: 'CurrentUser' | 'LocalMachine',
  exec: ExecFn = defaultExec,
): Promise<Buffer> {
  const { stdout } = await exec('powershell.exe', powershellArgs('Unprotect', scope), data.toString('base64'));
  return Buffer.from(stdout.trim(), 'base64');
}
