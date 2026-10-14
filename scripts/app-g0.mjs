import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../app', import.meta.url));
const cli = process.env.HBUILDERX_CLI || '/Applications/HBuilderX.app/Contents/MacOS/cli';
const target = process.argv[2] || 'open';
const targets = ['open', 'web', 'app-android', 'app-ios', 'app-harmony'];
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

try {
  await run(['open']);
  await run(['project', 'open', '--path', project]);
  if (target !== 'open') {
    // Development only. Never invoke cloud packaging or upload source code here.
    const args = ['launch', target, '--project', project];
    if (target === 'web') args.push('--browser', 'Chrome');
    else args.push('--compile', 'true');
    if (target === 'app-ios') args.push('--iosTarget', 'simulator');
    await run(args, target !== 'web', target === 'app-harmony');
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
