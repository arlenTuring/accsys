import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

function isPortListening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * 自動將獨立授權中心同步至與 ACCSYS 同層的 `../ACCSYS_LICENSE` 資料夾，
 * 並於本機背景啟動 `http://127.0.0.1:3005` 本地端授權碼簽發網頁。
 */
export async function ensureLocalLicenseStudioRunning(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const cwd = process.cwd();
    const stagedDir = path.join(cwd, 'ACCSYS_LICENSE');
    const siblingDir = path.resolve(cwd, '../ACCSYS_LICENSE');

    let serverUpdated = false;

    if (fs.existsSync(stagedDir)) {
      fs.mkdirSync(path.join(siblingDir, 'public'), { recursive: true });
      const filesToSync = [
        'package.json',
        'server.mjs',
        'start.sh',
        'public/index.html',
      ];
      for (const rel of filesToSync) {
        const src = path.join(stagedDir, rel);
        const dest = path.join(siblingDir, rel);
        if (fs.existsSync(src)) {
          const srcContent = fs.readFileSync(src, 'utf8');
          const destContent = fs.existsSync(dest)
            ? fs.readFileSync(dest, 'utf8')
            : '';
          if (srcContent !== destContent) {
            fs.writeFileSync(dest, srcContent, 'utf8');
            if (rel === 'server.mjs') {
              serverUpdated = true;
            }
          }
        }
      }
    }

    const activeDir = fs.existsSync(path.join(siblingDir, 'server.mjs'))
      ? siblingDir
      : stagedDir;

    const serverScript = path.join(activeDir, 'server.mjs');
    if (!fs.existsSync(serverScript)) return;

    if (serverUpdated) {
      try {
        execSync('lsof -tiTCP:3005 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true');
      } catch {
        // ignore
      }
    }

    const listening = await isPortListening(3005, '127.0.0.1');
    if (listening) return;

    const child = spawn(process.execPath, [serverScript], {
      cwd: activeDir,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        LICENSE_PORT: '3005',
      },
    });
    child.unref();
  } catch {
    // 非本機開發環境或無權限時靜默略過
  }
}
