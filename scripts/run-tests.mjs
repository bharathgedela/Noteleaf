import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is unavailable; run this script through npm test');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

let testStatus = 1;
try {
  const rebuildStatus = run(process.execPath, [npmCli, 'rebuild', 'better-sqlite3']);
  if (rebuildStatus !== 0) throw new Error('Could not rebuild better-sqlite3 for the Node test runtime');
  testStatus = run(process.execPath, [npmCli, 'exec', 'vitest', '--', 'run', '--config', 'vitest.config.ts']);
} finally {
  const restoreStatus = run(process.execPath, [npmCli, 'exec', 'electron-rebuild', '--', '-f', '-w', 'better-sqlite3']);
  if (restoreStatus !== 0) {
    console.error('Tests finished, but better-sqlite3 could not be restored for Electron. Run npm run postinstall.');
    testStatus = testStatus || restoreStatus;
  }
}

process.exitCode = testStatus;
