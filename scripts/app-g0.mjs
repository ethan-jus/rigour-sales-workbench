import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startDevelopmentBridge } from './app-dev-bridge.mjs';

const project = fileURLToPath(new URL('../app', import.meta.url));
const cli = process.env.HBUILDERX_CLI || '/Applications/HBuilderX.app/Contents/MacOS/cli';
const target = process.argv[2] || 'open';
const targets = ['open', 'web', 'app-android', 'app-ios', 'app-harmony', 'device-android'];
if (!targets.includes(target)) {
  console.error(`支持的目标：${targets.join(', ')}`);
  process.exit(1);
}

async function run(args, requireCompileReceipt = false, requirePackageReceipt = false) {
  await new Promise((resolve, reject) => {
    const child = spawn(cli, args, { stdio: ['inherit', 'pipe', 'pipe'] });
    let output = '';
    for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on('data', chunk => {
        destination.write(chunk);
        output = (output + chunk.toString()).slice(-65536);
      });
    }
    child.on('error', () => reject(new Error('无法启动 HBuilderX CLI，请安装或设置 HBUILDERX_CLI。')));
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`HBuilderX 退出码：${code}`));
      // HBuilderX 5.26 also exits 0 when a plugin, login or toolchain is missing.
      if (requireCompileReceipt && /编译失败|compilation failed|build failed/i.test(output)) {
        return reject(new Error('发现原生或插件编译失败，不能仅按页面编译成功判定通过。'));
      }
      if (requireCompileReceipt && !/编译成功|compiled successfully/i.test(output)) {
        return reject(new Error('未收到编译成功回执，请检查上方工具链或代码错误。'));
      }
      if (requirePackageReceipt && !/运行包制作成功/.test(output)) {
        return reject(new Error('未收到鸿蒙运行包制作成功回执，请检查上方 .hap 构建错误。'));
      }
      resolve();
    });
  });
}

let bridge;
try {
  await run(['open']);
  await run(['project', 'open', '--path', project]);
  if (target !== 'open') {
    // Development only. Never invoke cloud packaging or upload source code here.
    const args = ['launch', target === 'device-android' ? 'app-android' : target, '--project', project];
    if (target === 'device-android') {
      bridge = await startDevelopmentBridge(process.argv[3]);
      args.push('--deviceId', bridge.deviceId, '--playground', 'custom', '--customType', 'local');
    } else if (target === 'web') args.push('--browser', 'Chrome');
    else args.push('--compile', 'true');
    if (target === 'app-ios') args.push('--iosTarget', 'simulator');
    await run(args, target !== 'web', target === 'app-harmony');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  bridge?.stop();
}
