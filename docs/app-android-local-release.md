# Android 本地正式打包

原生工程使用 `app/`，HBuilderX 5.26.2026091802、VDOM；仓库根目录 `android/` 是旧 Capacitor 工程，不能用于本 App 发布。

## 日常命令

```sh
pnpm app:build:android
pnpm app:install:android
```

第一条在本机导出 Kotlin/资源、执行 Gradle、对齐并用既有证书签名；第二条再核对唯一连接设备上已安装应用的证书，执行 `adb install -r`。不卸载、不清空数据、不降级、不启动调试基座、不创建端口转发。安装失败时应查明原因，不改为卸载重装。

产物位于 `outputs/android-local/rigour-sales-<manifest版本>.apk`。版本号统一读 `app/manifest.json`；生产地址从现有 `app/services/config.uts` 校验。整个流程不调用云打包，不上传应用代码或签名材料。

## 本机依赖与签名

- HBuilderX 5.26.2026091802；可用 `HBUILDERX_CLI` 指定 CLI。
- JDK 21、Android SDK（默认 `~/Library/Android/sdk`，可设置 `ANDROID_HOME`）、build-tools 36.1.0、platform android-36。
- Gradle 8.14.3，默认复用本机 HBuilderX 已配置的安装路径；其他机器用 `RIGOUR_GRADLE` 指定可执行文件。
- 官方 VDOM SDK `Android-uni-app-x-SDK@15075-5.26`，首次自动下载到 `outputs/android-local` 并校验固定 SHA-256。SDK 与编译器必须配套，不自动升级。
- 私密配置 `outputs/android-local/signing.local.json`（权限 600，已被 `outputs/` 忽略），也可用 `RIGOUR_SIGNING_CONFIG` 指向本机文件。字段为 `packagename`、`certfile`、`certalias`、`storepassword`、`certpassword`、`certificateSha256`。后者固定为现有可信正式 APK 的签名证书 SHA-256，不是 APK 文件摘要。不得提交私钥或密码，不在命令参数里填写密码。

`app/AndroidManifest.xml` 保留现有高德客户端 Key，本地构建会合并它及源码原生插件的清单；不复制官方示例的测试权限、广告、支付或推送模块。平台 SDK 根据导出 manifest 模块清单装入，源码地图插件的依赖读取其 `config.json`。

临时原生工程在忽略提交的 `outputs/android-local/project`。每次替换生成源码和资源，保留 Gradle 构建缓存。首次构建仍需要下载 Maven 依赖，后续可复用缓存；“本地打包”不代表首次初始化完全无需网络。

## 验收要求

生成 APK 后校验签名、包名、版本、非 debuggable；安装前比对手机原包签名。真机核对登录保留、照片落盘与上传、录音与转写、地图标记与路线。只生成 APK 或编译成功不能代替真机验收。

官方依据：[原生工程配置](https://doc.dcloud.net.cn/uni-app-x/native/use/android.html)、[UTS 插件配置](https://doc.dcloud.net.cn/uni-app-x/native/use/androiduts.html)、[SDK 下载](https://doc.dcloud.net.cn/uni-app-x/native/download/android.html)。
