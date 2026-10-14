# G0 鸿蒙工具链准备记录

核查日期：2026-10-14（安装于 2026-10-13）。范围：官方安装包下载校验、本机安装与配置、模拟器镜像安装、鸿蒙编译及模拟器安装启动。首次 IDE 许可由用户自行完成；模拟器《软件许可及服务协议》和 SDK 许可经用户明确授权后交互确认。未执行云打包或真机签名。

**当前结果：HBuilderX 5.26 已用 DevEco Studio 26.0.0.851 编译生成 HAP，安装到 HarmonyOS 7.0.0 模拟器并启动，原生首页和设备检查页已截图核验。定位、录音交互和真机运行尚未验收。**

## 当前状态

- 用户完成华为登录后，实际打开[华为官方下载中心](https://developer.huawei.com/consumer/cn/download/)，当前稳定条目为 **DevEco Studio 26.0.0 Release，Build Version 26.0.0.851，发布日期 2026/09/23**。此前可索引版本文档中的 `.821` 已落后于实时下载目录。
- 已选择 **Mac (ARM64)**，官网文件名 `devecostudio-mac-arm-26.0.0.851.zip`，标注 3.8 GB；实际下载为 **4,078,480,294 字节**。
- 点击后直接进入华为 `contentcenter-vali-drcn.dbankcdn.cn` 签名下载链接，没有出现许可弹窗。Chrome 返回 `ERR_BLOCKED_BY_CLIENT`，随后使用该已显示的官方 HTTPS 链接下载，HTTP 200，TLS 验证结果为 0；未禁用浏览器安全功能，未使用第三方镜像。
- 安装包位于 `/Users/ethan/.cache/rigour-app-toolchain/devecostudio-mac-arm-26.0.0.851.zip`。临时 OAuth URL 和带签名下载 URL 不保存到仓库。
- 官网 ARM64 条目“SHA-256”复制结果与本机 `shasum -a 256` **完全一致**：`86289edeb2e8e30eb1adf80cba0fc55f0e57cdd4f6dc4ec9c59985a0bc4b8524`。
- ZIP 内安装镜像为 `devecostudio-mac-arm-26.0.0.851/deveco-studio-26.0.0.851-aarch64.dmg`（4,103,833,155 字节）。
- DMG 的 `Software License Agreement` 标记为 `false`；校验并只读挂载后，用 `ditto` 安装到 **`/Applications/DevEco-Studio.app`**，复制成功，无需 sudo。没有覆盖已有安装。
- 安装后主程序 `Contents/MacOS/devecostudio` 为 **Mach-O arm64**，`CFBundleVersion` 和 `Contents/Resources/build.txt` 均为 `DS-261.23567.138.36.2600851`。
- 开发者签名为 `Huawei Device Co,. LTD (TZEA3TN37Q)`，带 stapled notarization ticket。`codesign --verify --deep --strict --verbose=2` 成功；`spctl --assess --type execute --verbose=2` 返回 `accepted / source=Notarized Developer ID`。

版本以[华为官方下载中心实时目录](https://developer.huawei.com/consumer/cn/download/)为准；[华为官方 26.0.0 版本说明](https://developer.huawei.com/consumer/en/doc/harmonyos-releases/deveco-studio-new-features-2600)为补充信息。

## 本机与官方要求

| 项目 | 官网当前要求 | 本机只读检查 |
| --- | --- | --- |
| 架构 | macOS ARM 或 X86 对应安装包 | `arm64`，应选 ARM64 |
| macOS ARM 系统 | 12 / 13 / 14 / 15 / 26 | macOS 26.6.2 |
| 内存 | 8 GB 及以上 | 16 GiB |
| 硬盘 | 100 GB 及以上 | 安装前数据卷剩余约 157 GiB；这是安装前快照，不是当前余量 |
| 显示分辨率 | 1280 × 800 及以上 | 未读取，不声称已核验 |

要求来源：[华为官网“系统要求”](https://developer.huawei.com/consumer/cn/deveco-studio/)。命令：`uname -m`、`sw_vers`、`sysctl -n hw.memsize`、`df -h /Users/ethan/.cache`。没有修改系统设置。

## 已完成的配置与运行

1. 按[华为安装文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-software-install)完成首次启动；用户自行完成 IDE 许可，随后明确授权并交互确认模拟器《软件许可及服务协议》和 SDK 许可。实际 `devecostudio --version` 输出 `DevEco Studio 26.0.0.851`，退出码为 0。
2. 已从本机 HBuilderX `launcher/out/main.js` 确认配置键 `harmony.devTools.path`，通过 CLI 写入 `/Applications/DevEco-Studio.app` 并读回一致。正常重启此前仍误报版本的 HBuilderX 实例后，预检查通过，构建日志识别到 `26.0.0.851`。
3. `Emulator -imageList` 实测当前最新 Release 镜像为 `HarmonyOS7.0.0(26.0.0)`，软件版本 `7.0.0.107`，下载包为 **2,313,181,590 字节**，已完成下载和安装。创建 `RigourG0` 手机模拟器，ARM64、4 GB 内存、6 GB 数据存储；实例配置确认 API `26.0.0`，hdc 实际目标为 `127.0.0.1:5555`。
4. 通过项目编译脚本生成 HAP，再通过 HBuilderX 官方 `launch app-harmony` 安装和启动到上述模拟器。原生首页和设备检查页已实际显示。一次设备页预览后观察到系统桌面，日志显示页面返回和正常退后台、进程持续存活；未修改代码再次运行即成功显示设备页，没有将该现象认定为应用崩溃。

DCloud 配套依据：[鸿蒙运行与发行](https://uniapp.dcloud.net.cn/tutorial/harmony/runbuild)。本机 HBuilderX 为 `5.26.2026091802`。这次真实构建验证了当前 G0 项目与所装 DevEco、SDK 的编译组合；不代表其他原生模块、真机签名或发布包已经验证。

安装与构建使用的工具路径：

| 工具 | 实际路径 |
| --- | --- |
| SDK | `/Applications/DevEco-Studio.app/Contents/sdk/default` |
| Node | `/Applications/DevEco-Studio.app/Contents/tools/node/bin/node` |
| Hvigor | `/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw` |
| ohpm | `/Applications/DevEco-Studio.app/Contents/tools/ohpm` |
| 模拟器工具 | `/Applications/DevEco-Studio.app/Contents/tools/emulator` |
| hdc | `/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc` |

`Contents/sdk/default/sdk-pkg.json` 标记 `apiVersion: 26`、`platformVersion: 26.0.0`、`version: 26.0.0.105`、`releaseType: Release`。模拟器镜像与编译 SDK 分开存放：镜像位于 `/Users/ethan/Library/Huawei/Sdk/system-image/HarmonyOS-7.0.0/phone_all_arm/`，实例配置为 `/Users/ethan/.Huawei/Emulator/deployed/RigourG0/config.ini`。

HBuilderX 当前 VDOM 模式选用 `launcher-harmony/base/project-x.zip`，其中最低兼容版本为 `5.0.1(13)`、模型版本为 `5.0.0`，模板未指定目标或编译 SDK。最低兼容 API 13 不表示必须另装 API 13 SDK；DevEco 所带 Hvigor / OHOS 插件为 6.26.8，本次已用自带 SDK 完成实际构建。

### 首次启动导致的版本检查误报

首次编译在 `devecostudio --version` 等待 300 秒后，误报“需要 DevEco Studio 升级到 5.1.0.849+”。本机 launcher 在未读到版本时保留 `unknown`，未检查子进程失败状态便比较版本，导致该提示。完成首次启动后，独立 `--version` 已正常；旧 HBuilderX 实例仍误报，正常重启后预检查与编译均通过。没有修改或伪造版本，没有替换 IDE 或补丁修改工具源码。

## 可复现命令与证据

以下命令针对已经安装镜像、已经创建 `RigourG0` 的本机环境，按需逐条执行。已有模拟器运行时跳过启动命令，不重复创建实例。

```sh
# 查看模拟器和连接目标；需要时启动已有实例。
/Applications/DevEco-Studio.app/Contents/tools/emulator/Emulator -list -details
/Applications/DevEco-Studio.app/Contents/tools/emulator/Emulator -start RigourG0
/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc list targets

cd /Users/ethan/.codex/worktrees/rigour-sales-workbench-app-g0

# 仅编译并生成运行包：脚本使用 --compile true，不负责安装启动。
node scripts/app-g0.mjs app-harmony

# 安装并启动到本次已验证的模拟器目标。
/Applications/HBuilderX.app/Contents/MacOS/cli launch app-harmony --project /Users/ethan/.codex/worktrees/rigour-sales-workbench-app-g0/app --deviceId 127.0.0.1:5555
```

目标编号以 `hdc list targets` 的实际输出为准。运行包产物位于：

```text
app/unpackage/dist/dev/app-harmony/entry/build/default/outputs/default/entry-default-unsigned.hap
```

- `outputs/app-g0/harmony-after-restart-20261014.log`：页面编译成功、识别 DevEco `26.0.0.851`、工程依赖安装成功、运行包制作成功。首次构建产物为 **15,399,047 字节**；后续重编会覆盖该文件，大小是首次构建快照。
- `outputs/app-g0/harmony-run-20261014.log`：记录 `.hap` 安装成功及运行成功。日志同时存在未配置签名证书提示、性能提示以及模拟器系统告警，不能表述为“零错误”或“全部功能通过”。
- `outputs/app-g0/harmony-native-home.png`：实际运行后的原生首页截图，已查看核验。
- `outputs/app-g0/harmony-device-check-retry-20261014.log` / `harmony-native-device-check.png`：在上述启动命令末尾增加 `--pagePath pages/device-check/device-check`，设备检查页实际渲染。截图中的定位和录音均未开始，不代表能力已通过。

日常 UI 与业务开发在 HBuilderX 中修改仓库的 `app/` 源码；`app/unpackage/dist/dev/app-harmony/` 是自动生成的鸿蒙工程，可用于查看构建或调试信息，**不得当作业务源码目录直接修改**，否则下次编译会覆盖。

## 验收边界

- 已完成：官方稳定版本下载、SHA-256 与应用签名公证核验、安装与工具路径配置、经授权完成许可交互、镜像安装与模拟器创建、页面及 HAP 编译、模拟器安装启动、原生首页及设备检查页显示核验。
- 未完成：设备检查页交互验收、原生定位、录音及后台长录音、真机签名与真机运行。模拟器上的 unsigned HAP 是开发运行产物，不能作为员工内部试用安装包；模拟器成功不能替代三端真机能力验收。
- 临时打卡系统和平台后端未访问、未修改。
