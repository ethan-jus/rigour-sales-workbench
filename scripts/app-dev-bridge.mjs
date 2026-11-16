import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const sdkAdb = resolve(homedir(), 'Library/Android/sdk/platform-tools/adb');
const adb = process.env.ADB || (existsSync(sdkAdb) ? sdkAdb : '/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb');
const exec = promisify(execFile);
const runAdb = async args => (await exec(adb, args, { timeout: 8000 })).stdout;
const ports = [26880, 26881];

export function selectDevice(output, requested = '') {
  const devices = output.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(parts => parts[1] === 'device').map(parts => parts[0]);
  if (requested && devices.includes(requested)) return requested;
  if (requested) throw new Error('指定手机未连接或尚未授权 ADB 调试。');
  if (devices.length !== 1) throw new Error('请连接一台已授权的 Android 手机；多台设备时请在命令后指定 deviceId。');
  return devices[0];
}

export async function repairDevelopmentPorts(run, deviceId) {
  const output = await run(['-s', deviceId, 'reverse', '--list']);
  const mappings = output.split(/\r?\n/).map(line => line.trim().split(/\s+/));
  const missing = ports.filter(port => !mappings.some(parts => parts[1] === `tcp:${port}` && parts[2] === `tcp:${port}`));
  for (const port of missing) await run(['-s', deviceId, 'reverse', `tcp:${port}`, `tcp:${port}`]);
  return missing;
}

export async function startDevelopmentBridge(requested = '') {
  const config = readFileSync(new URL('../app/services/config.uts', import.meta.url), 'utf8');
  if (!/environment:\s*'development'/.test(config) || !ports.every(port => config.includes(`http://localhost:${port}`))) {
    throw new Error('当前 App 不是本地 localhost 开发配置，不启用 ADB 业务转发。');
  }
  const deviceId = selectDevice(await runAdb(['devices']), requested);
  await repairDevelopmentPorts(runAdb, deviceId);
  console.log(`[DEV 通道] ${deviceId} 已连接 Gateway 26880 / IAM 26881；调试期间每 2 秒检查并恢复丢失转发。`);
  let stopped = false;
  let unavailable = false;
  let timer;
  async function check() {
    try {
      const repaired = await repairDevelopmentPorts(runAdb, deviceId);
      if (!stopped && (unavailable || repaired.length)) console.log(`[DEV 通道] 已恢复手机连接${repaired.length ? '及端口 ' + repaired.join(' / ') : ''}。`);
      unavailable = false;
    } catch {
      if (!stopped && !unavailable) console.warn('[DEV 通道] 手机调试连接暂不可用，等待同一设备重新连接；不切换其他手机。');
      unavailable = true;
    }
    if (!stopped) timer = setTimeout(check, 2000);
  }
  timer = setTimeout(check, 2000);
  return { deviceId, stop() { stopped = true; clearTimeout(timer); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const bridge = await startDevelopmentBridge(process.argv[2]);
    process.once('SIGINT', () => bridge.stop());
    process.once('SIGTERM', () => bridge.stop());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
