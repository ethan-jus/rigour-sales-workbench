# 瑞盖销售工作台 · uni-app x

这是 `rigour-sales-workbench` 的 uni-app x 迁移工程，面向 Android、iOS 和纯 HarmonyOS。当前实施了五个主导航与业务页面，真实接口客户端、本机购物与拜访草稿已落地；公司登录配置及写入接口仍需完成，不能用于正式下单或打卡。旧 `src/` 和临时打卡服务保持现状；真机验收通过后再替换旧移动端实现。

## 打开和查看效果

主开发工具为 **HBuilderX**。本轮使用稳定版 **5.26.2026091802**，项目选择 VDOM（`vapor: false`）。后续升级编译器须重新执行三端检查。

1. 用 HBuilderX 的“文件 → 导入 → 从本地目录导入”打开本目录 `app/`，不要把旧 Vue 项目根目录当作 uni-app x 工程。
2. 查看页面：选择“运行 → 运行到浏览器”。这是 Web 预览，定位/录音按钮明确提示改用原生测试包。
3. 安卓：打开手机开发者选项及 USB 调试，连接电脑，从“运行到手机或模拟器”选择 Android 设备。原生调试辅助工具为 Android Studio。
4. iOS：使用 macOS + Xcode，连接 iPhone 或启动模拟器。真机安装涉及 Apple 签名及设备配置。
5. 纯鸿蒙：安装 DevEco Studio 和相应 SDK，配置开发者签名、设备，再从 HBuilderX 的 HarmonyOS 运行入口选择设备。

用户已在 HBuilderX 登录、绑定手机号，项目已首次获取并绑定 DCloud AppID `__UNI__EE5460C`，Web 本地发行构建已通过。不要再次点击“重新获取”随意更换这个标识。正式包继续沿用本仓库规划的 `com.rigour.workbench` 标识，Android/iOS 签名和鸿蒙 profile 均未提交。

本机 Xcode 27 使用 Device Hub；HBuilderX 5.26 普通模拟器入口仍使用旧名称，且标准基座架构与本机 iOS 26.5 不匹配。目前已用现有 iOS 17 模拟器显示原生首页，具体兼容路径及验收范围见 [验证记录](../docs/app-g0-validation.md#xcode-27-模拟器兼容性)。这不影响浏览器预览和目标编译，不需要重复处理 Xcode 许可。

本机鸿蒙工具链已完成安装：DevEco Studio 26.0.0.851、API 26、HarmonyOS 7.0.0 手机模拟器 `RigourG0`。未签名 HAP 已在模拟器安装并实际显示原生首页，运行命令见 [鸿蒙工具链记录](../docs/app-g0-harmony-setup.md)。该产物用于本机验证，真机安装仍需签名及设备配置。

在仓库根目录也可运行：

```bash
pnpm app:g0:open          # 打开 HBuilderX 并导入 app/
pnpm app:g0:web           # Web 开发预览，不发布
pnpm app:g0:check:android # Android 仅编译，不上传/打包/安装
pnpm app:g0:check:ios     # iOS 仅编译
pnpm app:g0:check:harmony # HarmonyOS 本地编译并制作 HAP，不安装
pnpm app:g0:test          # 原生采集 API 模拟状态测试
pnpm app:v1:test          # 登录、API、购物和拜访状态测试；不是硬件验收
```

macOS 默认 CLI 路径为 `/Applications/HBuilderX.app/Contents/MacOS/cli`。其他安装位置通过 `HBUILDERX_CLI` 指定。首次运行会下载编译器插件；HBuilderX 部分发行功能要求先登录，命令退出码为 0 也不一定表示编译成功，必须检查控制台与生成物。

## 本轮实现

- 暖白/橙色页面：工作台、客户、拜访、订单、我的五个 Tab，以及登录、商品、购物草稿、订单详情、拜访材料、业绩与设置等子页面。未知统计显示未提供，没有伪造身份或提交成功。
- CRM/ERP/Order/Sales 只读接口按平台权限读取。报价、正式下单、收款提报、提成与打卡写入缺口见 [接口审查](../docs/app-v1-api-readiness.md)。
- Android 系统浏览器 OAuth Code + PKCE 接入骨架；配置默认空。其他端安全登录仍待接入；Token 仅内存，未写普通本机存储。
- 草稿按账号隔离：购物按客户分别保存，拜访照片复制到沙盒并可预览/移除；保存失败不回报提交成功。
- 原生系统 WGS84 定位。回调接收时间与硬件采样时间明确区分；未知精度不是 0。
- 原生录音启动、暂停、继续、停止；页面切入后台仅记录生命周期，不主动结束录音。
- 停止后复制录音到 `USER_DATA_PATH/rigour-capture`，再写每段小型 JSON 索引。两步都成功才显示保存成功；不把整段音频读成 Base64。
- 重启后读取本机索引和文件、回放；失败时保留原临时文件路径并允许重试保存。

## 尚未通过的发布门槛

- 三端编译、签名安装、后台权限和音频会话仍需逐端验收。标准测试基座的能力不等于正式自定义包的能力。
- 两小时只是本轮录音测试参数，不代表已经连续录满两小时，也不是正式产品上限。
- 当前停止后才持久保存，尚未实现录制中断电/杀进程恢复、持久分段日志、断点续传或服务器回执。不能因此宣称长录音已经可靠。
- 浏览器预览、API 模拟测试、模拟器录音都不能替代三种手机的后台/锁屏/来电真机实验。
- 真实平台登录联调、三端安全 Token 存储、地图/地址、200 米服务端规则、正式打卡及上传尚未完成。本轮没有访问生产 API。
- 后台管理继续属于平台 Sales 模块，App 不自行维护权限和业务状态机。

精确平台合同见 [app-g0-platform-contract.md](../docs/app-g0-platform-contract.md)。G0 验证记录见 [app-g0-validation.md](../docs/app-g0-validation.md)。

## 真机试验记录

每台手机记录系统、型号、包版本、录音前后实际回放时长和缺口；依次做前台、锁屏、切应用、来电中断、低电量、断网和重启实验。只有回放文件与事件日志一致才算该项通过，不以屏幕计时继续跳动作为证据。

官方资料：[uni-app x 工程](https://doc.dcloud.net.cn/uni-app-x/project.html)、[原生环境](https://doc.dcloud.net.cn/uni-app-x/tutorial/app-env.html)、[HBuilderX CLI](https://hx.dcloud.net.cn/cli/README)。
