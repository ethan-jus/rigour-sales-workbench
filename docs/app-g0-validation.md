# G0 验证记录

日期：2026-10-13，工具链跟进于 2026-10-14。分支：`codex/sales-app-three-platform-g0`。本轮仅本地开发，未部署、未改变临时打卡、未调用业务生产接口。

## 当前结果

| 检查 | 结果 | 能证明什么 |
|---|---|---|
| HBuilderX 安装/导入 | 5.26.2026091802 ARM64，`app/` 已导入 | 本机已有官方稳定版工具和新工程 |
| Web 开发编译 | 通过，VDOM / 样式隔离 2.0 | 工程可生成浏览器预览 |
| Web 本地发行构建 | 通过，账号手机号前置已解除 | 已生成 `app/unpackage/dist/build/web`，仅本地导出，未托管发布 |
| Android 编译 | 通过，日志确认编译为 Android class | 页面/服务通过 Kotlin 目标编译；未生成签名 APK |
| iOS 目标编译 | 通过，`app-service.js` / `app-config.js` 已生成 | iOS VDOM 目标资源编译通过；不是 Xcode 链接/IPA/真机验收 |
| iOS 模拟器原生首页 | iOS 17 / iPhone 15 Pro 标准基座显示成功 | 通过 `simctl` 安装及资源同步显示首页；Device Hub 自动触控未得到页面跳转回执，不能宣称交互/录音通过 |
| HarmonyOS 原生编译 | 通过，收到编译及运行包制作成功回执 | DevEco Studio 26.0.0.851 / API 26 已生成本地未签名 HAP；不代表真机发行包通过 |
| HarmonyOS 模拟器原生页面 | HarmonyOS 7.0.0 / RigourG0 显示成功 | HAP 已安装，`com.rigour.workbench` 首页及设备检查页实际渲染；定位/录音交互和麦克风/GPS 尚未验收 |
| 录音/定位 API 模拟测试 | 11 项通过 | 状态顺序、失败重试、快速重进会话隔离等应用逻辑；不证明麦克风或 GPS 工作 |
| Playwright 浏览器检查 | Chrome 与 WebKit 各通过 | 390×844：首页、页面跳转、刷新、返回、无横向溢出、原生能力门禁、无 JS 异常及外部请求 |
| Web 发行版 Playwright | 两引擎功能检查通过；零外部请求检查未通过 | 导航、能力门禁、刷新、返回正常；框架 CSS 各请求一次外部阴影图片，未发现统计接口请求 |
| 真机 / 两小时后台录音 | 尚未执行 | 不将 UI 计时或模拟器结果当作连续录音证据 |

第一次 Android 编译定位到了 UTS 局部函数前向引用错误；调整声明顺序后通过。iOS 编译提示全局标签选择器不受支持，已移除后重编通过。

HBuilderX 的失败/缺插件场景也可能退出码为 0，因此 `scripts/app-g0.mjs` 除检查退出码外，还要求本机编译器的成功回执。鸿蒙还必须出现“运行包制作成功”，只有页面编译成功不能判定 HAP 构建通过。14 项本地假 CLI 检查通过，覆盖缺回执、非零退出码和其他目标兼容性；这些检查不代替真实构建。

## 复现命令

```bash
pnpm install --frozen-lockfile
pnpm app:g0:test
pnpm app:g0:web
pnpm app:g0:check:android
pnpm app:g0:check:ios
pnpm app:g0:check:harmony
```

Web 开发服务器本次为 `http://localhost:5173/`，后续以运行输出为准。浏览器检查使用本机 Playwright 1.62.1、已安装 Chrome 与 WebKit，分别执行首页 → 设备检查 → 定位/录音按钮 → 刷新 → 返回；检查没有离开 loopback 的网络请求。截图保存在未提交的 `outputs/app-g0/`。

发行版使用 `cli publish web --project <app目录>` 本地导出后，在 `http://127.0.0.1:8791/` 验证。新编译器在未配置时会默认启用 uni统计，已在 `manifest.json` 显式设置 `uniStatistics.enable: false` 后重构建；日志不再显示启用统计，发行文件未命中指定统计域名/接收器签名。浏览器静置后仍会请求框架 CSS 的 `https://cdn1000.dcloud.net.cn/img/shadow-grey.png`，这是外部视觉资源，不代表统计开启，也不能把此构建描述为完全无外部依赖。完整报告见忽略产物 `outputs/app-g0/release-browser-report.md` / `.json`。

## Xcode 27 模拟器兼容性

用户已自行完成 Xcode 许可与首次设置，`xcodebuild -version` 返回 Xcode 27.0（27A266a），`simctl` 已可用。剩下的问题与许可无关：

- HBuilderX 5.26 普通运行入口仍调用 `open -a Simulator`；本机 Xcode 27 提供的是 `/Applications/Xcode.app/Contents/Applications/DeviceHub.app`，该旧名称启动失败。
- 标准基座 `uniappx-launcher/base/Pandora_simulator.app` 的主二进制是 x86_64；本机 iOS 26.5 runtime 只有 arm64。不能靠“编译成功”略过这个安装架构限制。
- 改用本机已有的 iOS 17 runtime（同时支持 x86_64 / arm64），以 `simctl` 安装、启动 `io.dcloud.uniappx` 标准基座。参照本机 DCloud launcher/automator 的同步流程，将 `app/unpackage/dist/dev/app-ios/` 内容复制到基座沙盒 `Documents/uni-app-x/apps/__UNI__uniappx/www/`；在 `apps/.debug/.reset` 写入 `HBuilderX`，向 `apps/.debug/.debug/.debug` 写入 `<root cmd="restart"></root>` 刷新指令。没有修改 HBuilderX/Xcode 安装文件或项目 AppID。
- 首页已实际渲染，截图为 `outputs/app-g0/ios-native-home.png`。本轮 Device Hub 的自动点击/拖动未收到导航结果，因此只记录原生首页渲染，不把尝试点击当作交互验收；没有采集麦克风或真实位置。

工具依据：[Apple Device Hub](https://developer.apple.com/documentation/xcode/device-hub)、[DCloud 模拟器架构要求](https://uniapp.dcloud.net.cn/tutorial/run/installSimulator)。5.31 当前为 Alpha，本轮未为此替换稳定编译器，也未删除现有模拟器。

## 下一步实际前置

1. DCloud 登录、AppID `__UNI__EE5460C` 和手机号绑定已完成并通过本地发行检查；不再要求重复处理。没有借用示例 AppID、没有云打包上传源码。
2. Xcode 许可已由用户处理。iOS 继续完成交互及自定义原生包验证，记录好上面的工具兼容限制。
3. DevEco Studio 26.0.0.851 已安装，官方 SHA-256、华为签名及 Apple 公证检查通过。用户已完成 IDE 首次许可，并明确授权接受本次模拟器两项协议；镜像安装、HAP 构建、模拟器启动和原生首页显示均已完成。首次启动时版本查询超时导致的“版本过低”提示在正常重启 HBuilderX 后解除，没有修改工具二进制。复现步骤及日志见 [鸿蒙工具链记录](app-g0-harmony-setup.md)；下一步仍需真机签名和设备能力验证。
4. 准备 Android、iPhone、纯 HarmonyOS 真机，检查标准基座与自定义包的实际原生配置。基座可录音不等于正式包具备后台能力。
5. 确认平台 DEV 的 OAuth 公共客户端、回调、员工身份及规则，按合同接入，只在明确测试环境生成拜访。

G0 仍为**进行中**。后台原生服务/音频会话、录制中持久分段、异常恢复和可恢复上传尚未交付，不进入内部销售试用阶段。
