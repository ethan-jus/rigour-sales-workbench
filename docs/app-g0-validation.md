# G0 验证记录

日期：2026-10-13。分支：`codex/sales-app-three-platform-g0`。本轮仅本地开发，未部署、未改变临时打卡、未调用业务生产接口。

## 当前结果

| 检查 | 结果 | 能证明什么 |
|---|---|---|
| HBuilderX 安装/导入 | 5.26.2026091802 ARM64，`app/` 已导入 | 本机已有官方稳定版工具和新工程 |
| Web 开发编译 | 通过，VDOM / 样式隔离 2.0 | 工程可生成浏览器预览 |
| Web 本地发行构建 | 账号前置未满足 | 已登录并绑定 AppID；DCloud 仍要求账号绑定手机号，未生成发行产物 |
| Android 编译 | 通过，日志确认编译为 Android class | 页面/服务通过 Kotlin 目标编译；未生成签名 APK |
| iOS 目标编译 | 通过，`app-service.js` / `app-config.js` 已生成 | iOS VDOM 目标资源编译通过；不是 Xcode 链接/IPA/真机验收 |
| HarmonyOS 编译 | 未通过环境前置 | 本机未安装/配置 DevEco 工具链，不能据其他两端宣称鸿蒙通过 |
| 录音/定位 API 模拟测试 | 11 项通过 | 状态顺序、失败重试、快速重进会话隔离等应用逻辑；不证明麦克风或 GPS 工作 |
| Playwright 浏览器检查 | Chrome 与 WebKit 各通过 | 390×844：首页、页面跳转、刷新、返回、无横向溢出、原生能力门禁、无 JS 异常及外部请求 |
| 真机 / 两小时后台录音 | 尚未执行 | 不将 UI 计时或模拟器结果当作连续录音证据 |

第一次 Android 编译定位到了 UTS 局部函数前向引用错误；调整声明顺序后通过。iOS 编译提示全局标签选择器不受支持，已移除后重编通过。

HBuilderX 的失败/缺插件场景也可能退出码为 0，因此 `scripts/app-g0.mjs` 除检查退出码外，还要求本机编译器的成功回执。鸿蒙环境缺失时脚本实际返回 1，不误报成功。

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

## 下一步实际前置

1. 用户已自行登录 HBuilderX，已在空项目首次获取并保存 AppID `__UNI__EE5460C`。发行检查提示还需用户绑定手机号；已告知用户，不接收手机号/验证码。没有借用示例 AppID、没有云打包上传源码。
2. Xcode 当前尚未完成首次许可确认，`xcrun simctl` 被许可提示拦截，需用户本人阅读并处理。未代替用户接受许可。
3. 安装并配置 DevEco Studio / SDK，完成 HarmonyOS 开发者与设备签名配置。
4. 准备 Android、iPhone、纯 HarmonyOS 真机，检查标准基座与自定义包的实际原生配置。基座可录音不等于正式包具备后台能力。
5. 确认平台 DEV 的 OAuth 公共客户端、回调、员工身份及规则，按合同接入，只在明确测试环境生成拜访。

G0 仍为**进行中**。后台原生服务/音频会话、录制中持久分段、异常恢复和可恢复上传尚未交付，不进入内部销售试用阶段。
