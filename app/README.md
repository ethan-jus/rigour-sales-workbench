# 三端销售 App · G0

这是 `rigour-sales-workbench` 的 uni-app x 迁移工程，面向 Android、iOS 和纯 HarmonyOS。当前交付为基础工程与原生能力检查入口，不能用于正式打卡。旧 `src/` 和临时打卡服务保持现状；真机验收通过后再替换旧移动端实现。

## 打开和查看效果

主开发工具为 **HBuilderX**。本轮使用稳定版 **5.26.2026091802**，项目选择 VDOM（`vapor: false`）。后续升级编译器须重新执行三端检查。

1. 用 HBuilderX 的“文件 → 导入 → 从本地目录导入”打开本目录 `app/`，不要把旧 Vue 项目根目录当作 uni-app x 工程。
2. 查看页面：选择“运行 → 运行到浏览器”。这是 Web 预览，定位/录音按钮明确提示改用原生测试包。
3. 安卓：打开手机开发者选项及 USB 调试，连接电脑，从“运行到手机或模拟器”选择 Android 设备。原生调试辅助工具为 Android Studio。
4. iOS：使用 macOS + Xcode，连接 iPhone 或启动模拟器。真机安装涉及 Apple 签名及设备配置。
5. 纯鸿蒙：安装 DevEco Studio 和相应 SDK，配置开发者签名、设备，再从 HBuilderX 的 HarmonyOS 运行入口选择设备。

用户已在 HBuilderX 登录，项目已首次获取并绑定 DCloud AppID `__UNI__EE5460C`。不要再次点击“重新获取”随意更换这个标识。正式包继续沿用本仓库规划的 `com.rigour.workbench` 标识，Android/iOS 签名和鸿蒙 profile 均未提交。

在仓库根目录也可运行：

```bash
pnpm app:g0:open          # 打开 HBuilderX 并导入 app/
pnpm app:g0:web           # Web 开发预览，不发布
pnpm app:g0:check:android # Android 仅编译，不上传/打包/安装
pnpm app:g0:check:ios     # iOS 仅编译
pnpm app:g0:check:harmony # HarmonyOS 仅编译
pnpm app:g0:test          # 本地 API 模拟状态测试，不是硬件验收
```

macOS 默认 CLI 路径为 `/Applications/HBuilderX.app/Contents/MacOS/cli`。其他安装位置通过 `HBUILDERX_CLI` 指定。首次运行会下载编译器插件；HBuilderX 部分发行功能要求先登录，命令退出码为 0 也不一定表示编译成功，必须检查控制台与生成物。

## 本轮实现

- App 首页与设备检查页；首页没有伪造销售身份、统计或提交成功状态。
- 原生系统 WGS84 定位。回调接收时间与硬件采样时间明确区分；未知精度不是 0。
- 原生录音启动、暂停、继续、停止；页面切入后台仅记录生命周期，不主动结束录音。
- 停止后复制录音到 `USER_DATA_PATH/rigour-capture`，再写每段小型 JSON 索引。两步都成功才显示保存成功；不把整段音频读成 Base64。
- 重启后读取本机索引和文件、回放；失败时保留原临时文件路径并允许重试保存。

## 尚未通过的发布门槛

- 三端编译、签名安装、后台权限和音频会话仍需逐端验收。标准测试基座的能力不等于正式自定义包的能力。
- 两小时只是本轮录音测试参数，不代表已经连续录满两小时，也不是正式产品上限。
- 当前停止后才持久保存，尚未实现录制中断电/杀进程恢复、持久分段日志、断点续传或服务器回执。不能因此宣称长录音已经可靠。
- 浏览器预览、API 模拟测试、模拟器录音都不能替代三种手机的后台/锁屏/来电真机实验。
- 平台登录、三端安全 Token 存储、地图/地址、200 米服务端规则、拍照、正式打卡及上传尚未接入。本轮没有访问生产 API。
- 后台管理继续属于平台 Sales 模块，App 不自行维护权限和业务状态机。

精确平台合同见 [app-g0-platform-contract.md](../docs/app-g0-platform-contract.md)。G0 验证记录见 [app-g0-validation.md](../docs/app-g0-validation.md)。

## 真机试验记录

每台手机记录系统、型号、包版本、录音前后实际回放时长和缺口；依次做前台、锁屏、切应用、来电中断、低电量、断网和重启实验。只有回放文件与事件日志一致才算该项通过，不以屏幕计时继续跳动作为证据。

官方资料：[uni-app x 工程](https://doc.dcloud.net.cn/uni-app-x/project.html)、[原生环境](https://doc.dcloud.net.cn/uni-app-x/tutorial/app-env.html)、[HBuilderX CLI](https://hx.dcloud.net.cn/cli/README)。
