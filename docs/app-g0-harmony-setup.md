# G0 鸿蒙工具链准备记录

核查日期：2026-10-14（安装于 2026-10-13）。范围：官方来源核对、安装包下载校验、本机安装验证、HBuilderX 工具路径配置及编译入口检查；未代为接受许可、未执行云打包。

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
| 硬盘 | 100 GB 及以上 | 数据卷剩余约 157 GiB；仅表示当前容量余量 |
| 显示分辨率 | 1280 × 800 及以上 | 未读取，不声称已核验 |

要求来源：[华为官网“系统要求”](https://developer.huawei.com/consumer/cn/deveco-studio/)。命令：`uname -m`、`sw_vers`、`sysctl -n hw.memsize`、`df -h /Users/ethan/.cache`。没有修改系统设置。

## 后续安装与配置

1. 下载、SHA-256 核验、安装和应用签名核验已完成。如后续出现许可、新授权或验证码，停在对应交互交由用户处理。
2. 按[华为安装文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-software-install)处理首次启动、许可和 SDK 设置。2026-10-14 用户解锁后，实际看到首次语言选择页，继续后到达《HUAWEI DevEco Studio 用户协议》与《HarmonyOS SDK 许可协议》的确认页；已请用户自行阅读并决定是否接受，尚未点击“同意”。可选统计共享不是必选项。
3. 已从本机 HBuilderX `launcher/out/main.js` 确认配置键 `harmony.devTools.path`，通过 CLI 写入 `/Applications/DevEco-Studio.app` 并读回一致；无需猜测配置键。后续仍需检查实际构建、配套 SDK 和模拟器，不能仅凭路径配置宣称工具链就绪。
4. 建立模拟器并运行本项目。真机调试另需华为账号对应的调试签名；发布包需要发布签名。模拟器成功不能替代真机定位和后台长录音验收。

DCloud 配套依据：[鸿蒙运行与发行](https://uniapp.dcloud.net.cn/tutorial/harmony/runbuild)。文档要求 HBuilderX 4.81 起 DevEco Studio 至少 5.1.0.849；本机 HBuilderX 为 5.26.2026091802。最新版 DevEco 与本项目 HBuilderX 的完整编译兼容性尚未实测，需以真实构建结果判定，不能只比较版本大小。

安装包自带的可核验路径（尚未运行这些工具）：

| 工具 | 实际路径 |
| --- | --- |
| SDK | `/Applications/DevEco-Studio.app/Contents/sdk/default` |
| Node | `/Applications/DevEco-Studio.app/Contents/tools/node/bin/node` |
| Hvigor | `/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw` |
| ohpm | `/Applications/DevEco-Studio.app/Contents/tools/ohpm` |
| 模拟器工具 | `/Applications/DevEco-Studio.app/Contents/tools/emulator` |
| hdc | `/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc` |

`Contents/sdk/default/sdk-pkg.json` 标记 `apiVersion: 26`、`platformVersion: 26.0.0`、`version: 26.0.0.105`、`releaseType: Release`。工具存在不等于 HBuilderX 与 SDK 已配置成功，也不等于已有模拟器镜像或真机签名。

HBuilderX 当前 VDOM 模式选用 `launcher-harmony/base/project-x.zip`，其中最低兼容版本为 `5.0.1(13)`、模型版本为 `5.0.0`，未指定目标或编译 SDK。最低兼容 API 13 不表示必须另装 API 13 SDK；DevEco 所带 Hvigor / OHOS 插件为 6.26.8，launcher 依赖的 13 项工具路径均存在，实际构建兼容性仍待验证。

### 首次启动导致的版本检查误报

上次编译入口在 `devecostudio --version` 等待 300 秒后，输出“需要 DevEco Studio 升级到 5.1.0.849+”，并未生成鸿蒙构建。只读检查本机 launcher 发现：版本读取只接受 stdout 中以 `DevEco Studio ` 开头的行，无输出时保留 `unknown`；子进程无输出超时后，版本函数未检查失败状态，把 `unknown` 交给版本比较，结果小于最低版本。因此该提示不能证明实际安装版本过低。安装的 `Resources/product-info.json` 为 `26.0.0.851`，该字符串比较可通过。先完成首次启动，再检查真实 `--version` 输出并重试编译；没有修改或伪造版本，也未替换 IDE。

## 验收边界

- 已完成：官方当前稳定版本与入口确认、本机条件核查、ARM64 安装包下载和官方 SHA-256 核验、安装到 Applications、架构与开发者签名及公证核验。
- HBuilderX 的 DevEco 路径已配置并读回确认。未完成：首次启动许可确认、SDK/模拟器验证、鸿蒙编译、签名、真机运行。Mac 已解锁，目前等待用户处理实际协议页。
- 临时打卡系统和平台后端未访问、未修改。本文件是本子任务唯一仓库改动。
