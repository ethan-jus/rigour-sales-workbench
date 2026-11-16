# 销售工作台应用标识

2026-11-13 用户最终确定：产品名、桌面名称、登录页统一为 **销售工作台**，不加公司前缀或 DEV 后缀；当前包仍只连接 DEV。Logo 使用现有 `app/static/sales/logo.png` 公司橙色 R，不重绘品牌，不使用 DCloud 默认 H／U 图标。

## 两个安装包的关系

本次 Redmi 真机只读核验：

| 包名 | 任务开始时版本 | 用途 |
| --- | --- | --- |
| `io.dcloud.uniappx` | 5.26.15075 / 526 | 早期 DCloud 标准测试基座，2026-10-14 安装；不再作为本项目销售测试入口 |
| `com.rigour.workbench` | 0.2.0 / 200 | 2026-11-13 安装的自定义开发基座，包含已接入的原生地图；后续继续覆盖更新此包 |

包名不同，Android 会将它们视为两个独立应用。任务开始时两者并存，本轮仅获准同包保留数据更新，没有卸载授权。安装期间发生了下述并行卸载／重装，当前已只剩公司包；不能声称旧本地数据已保留。

## 配置与素材

- `app/manifest.json`：统一名称、0.2.1 / 201、Android 四种密度的图标路径。保持原 AppID `__UNI__EE5460C`。
- `app/static/brand/icon-{72,96,144,192}.png`：从现有 Logo 等比缩放的打包资源，未重新设计公司标识。
- `app/nativeResources/android/res/mipmap-anydpi-v26/icon.xml`：Android 8+ 自适应图标，白底、橙色 R；前景保留安全边距，可随桌面采用圆形或圆角蒙版。主题单色图标复用相同轮廓。
- `app/nativeResources/android/res/drawable*`：图标前景、白色背景与品牌位图。
- 登录页继续显示完整产品名与现有 Logo；业务环境仍为 DEV。

本轮只配置 Android 桌面图标，不声称 iOS／鸿蒙桌面图标已安装验收。

## 后续运行

HBuilderX 打开 `app/`，选择 **自定义基座 → 本地基座**。现有本机 `app/.hbuilderx/launch.json` 已是 `playground: custom`。CLI 使用官方 `launch app-android --project <app绝对路径> --deviceId <当前设备ID> --playground custom`。不要再使用 `--playground standard`。

名称、桌面图标、原生资源更新必须重新制作开发基座，再以相同包名和相同调试签名覆盖安装；业务源码热更新不会替换安装包图标。沿用 [高德开发基座流程](app-amap-android.md)，不换包名或签名，不新建第三个包，不发布生产。

## 本轮验证状态

- 已核对两个真实安装包的版本及安装时间，旧自定义 APK 使用的确实仍是 DCloud 默认绿色 U 图标。
- 已验证四种 PNG 尺寸和 Manifest 图标路径；Android 原生图标资源通过 AAPT2 编译。
- Android／iOS 目标编译通过，HarmonyOS 编译及本地未签名 HAP 制作通过。首次 Android 编译发现首页重试按钮残留未定义的 `checkingIn`，本轮仅移除该一处引用；其余既有首页改动保留。该检查不等于 iOS／鸿蒙真机验收。
- 用户已明确授权 DCloud 构建；16:22:24 提交，16:45:26 云打包成功。产物 40,719,134 字节，包名 `com.rigour.workbench`、版本 0.2.1 / 201、应用名称与启动 Activity 标签均为“销售工作台”；自适应图标已包含 R 前景和白色背景。
- 新旧 APK 签名 SHA256 相同。手机 16:46 已装入新包，安装 APK 的 SHA256 与本次 DCloud 产物一致；投屏实见系统应用信息显示 R 图标、“销售工作台”、0.2.1，登录页名称也一致。后续留在 APP 登录页，未执行账号登录或业务提交。
- 本轮旧 APK 备份、配置备份与编译日志保存在忽略提交的 `outputs/app-branding-20261113/`。

官方依据：[uni-app x 工程与基座](https://doc.dcloud.net.cn/uni-app-x/project.html)、[Android 图标配置](https://doc.dcloud.net.cn/uni-app-x/collocation/manifest-android.html)。

## 安装期间的并行变更：数据保留未通过

本轮准备执行 `adb install -r` 前，发现手机已经被另一路运行进程装上新包，因此本轮未执行安装、卸载或清数据命令。

- 系统日志明确记录 16:24:33 `io.dcloud.uniappx` 被删除，16:24:37 `com.rigour.workbench` 被删除。
- 另有 16:44:24 启动的 HBuilder CLI `launch app-android ... --playground custom --customType local` 进程；新包于 16:46:00 安装。用户随后明确确认“是，另一会话操作过，已暂停”，并行操作来源已澄清；这不构成后续卸载或清数据授权。
- 公司包 UID 从 10226 变为 10242；首次安装时间从 11:37:07 变为 16:46:00。这不是保持原安装身份的覆盖升级。此前记住的 bjzs 用户名在新登录页也已为空，不能宣称原本地会话或材料保留。
- 当前旧标准基座已不在安装列表。没有证据证明手机旧本地草稿／待上传材料已备份或可恢复。旧 APK 备份仅是安装文件，不是应用数据备份。
- 本轮未改后端业务数据、未发布生产、未删除临时打卡数据；并行卸载对手机未上传材料的影响仍待确认。
- 证据：`before-install-package.txt`、`after-install-package.json`、`concurrent-install-system-events.log`、`final-installed-packages.txt`。最终 APK 保存为 `sales-workbench-0.2.1-dev.apk`，云构建回执为 `cloud-pack.log`，均在本轮 outputs 目录。
