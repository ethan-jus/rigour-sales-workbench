# Android 高德地图接入（2026-11-13）

原项目 `app/` 的“外勤记录”使用高德原生地图。系统定位、Sales 轨迹存储和里程算法保持原职责；原始 WGS84 坐标保留，地图使用接口返回的 GCJ02 坐标。地图不启动高德定位，不上传拜访名称或录音给地图服务。

## 依赖与平台

- 官方 `uni-map-amap` **1.5.1**，来源 <https://ext.dcloud.net.cn/plugin?id=25947>，Android TextureView 适合页内滚动。
- 此仓库只纳入官方插件的 **Android 子集**：保留 Android 原生实现、公共类型与组件，移除本批未启用的 `utssdk/app-ios`、`utssdk/app-harmony`，`uni-ext-api` 只注册 Kotlin。HBuilderX 会扫描已安装的原生插件，不能仅靠页面条件编译隔离未启用平台的原生依赖。
- 不修改厂商 Android SDK 代码。升级插件时重新检查上述平台范围，不直接用“全部覆盖”恢复未配置的平台。
- iOS/Harmony 当前显示记录与地图不可用提示；需要各自 Key、原生配置与独立验收。Harmony 官方插件要求 HBuilderX 5.34+ 和 Vapor，当前工程维持 5.26、VDOM。

## 本机配置

- 高德应用：销售打卡生产API；Key 名：工作台Android开发。
- 包名：`com.rigour.workbench`；DCloud AppID：`__UNI__EE5460C`。
- 绑定本机 `~/.android/debug.keystore` 的 `androiddebugkey` 调试签名。SHA1：`EC:86:C5:52:4D:DB:2E:B4:0C:66:04:BD:1F:9F:B7:5B:7C:76:6F:08`。只用于开发，发行包需另核正式签名。
- SDK Key 在忽略提交的 `app/AndroidManifest.xml`，模板为 `docs/AndroidManifest.example.xml`；不写入共享 `manifest.json`、日志或文档。
- 本机云打包参数位于忽略提交的 `outputs/amap-android/custom-base.local.json`。使用自有调试签名、`iscustom: true`，关闭广告。仅用户明确批准后调用 `cli pack --config <本机参数绝对路径>`。
- HBuilderX 原生依赖路径已配置到本机已有 Android SDK、Gradle 8.14.3、JDK 21。依赖首次下载失败后已重新解析并完成编译；未修改全局 Gradle 源或 Java 默认版本。

## 页面边界

- 数据模型 `FieldPoint/FieldLine/FieldMarker` 与地图供应商分离；SDK 类型转换集中在 `field-route-map`。
- 首次同意高德 SDK 说明后才创建地图，选择按账号环境隔离存储。不同意时仍可查看记录；地图右上角仅保留全屏/收起图标，已按用户要求移除隐私菜单及关闭地图操作。
- 签到绿点、签退橙点、拜访蓝点，使用原生可解码 PNG。点击标记选中同一条时间线，点击记录定位或进入已有拜访。
- 每段可靠轨迹独立画线，不跨缺口补线；里程采用服务端结果，不能计算时不显示为零。
- 日期与账号变化卸载旧地图，防止上一账号位置残留；不自动开启当前定位蓝点。
- 地图右上角四角图标切换全屏，收起图标回到原记录位置；Android 返回键/标题返回先退出全屏。全屏使用当前日期已读取的轨迹，不新增接口请求，同一时刻只挂载一份地图。按钮触控区域 48×48，白底 32×32、圆角 6px，图标 22×22，保留系统导航区域。

## 验收记录

- Android 目标原生编译通过；包含厂商 Kotlin 插件编译。
- 原生测试 **276/276** 通过，其中新增用例覆盖轨迹不跨断点连线、里程使用服务端口径、地图标记与排序后时间线对应。
- iOS 页面编译通过，未启用 iOS 高德插件。曾出现插件失败但页面成功的双重回执，检查脚本现优先判定失败；正反日志夹具验证通过。
- 鸿蒙页面编译与未签名 HAP 制作通过；未启用鸿蒙高德插件。
- DCloud 开发基座制作成功，2026-11-13 11:10:55 完成，40,624,874 字节；本次未购买收费套餐。产物为 `app/unpackage/debug/android_debug.apk`，SHA256：`c60bde283f4b94df4a60b46ddb974f5f0ad8946e74bcdbc4e9333da1a3eec548`。
- APK 的包名、调试签名、包内 Key 与本机配置一致，包含高德 Android 原生库。11:41 已在 Redmi M2007J22C 启动 `com.rigour.workbench`，原项目最新资源同步成功。
- 新基座登录检查发现 HBuilderX 启动后只保留自己的 8000/8001 转发，26880/26881 转发被清除。已在启动完成后恢复两个业务端口，并从手机端访问 IAM、Gateway 健康接口均返回 `UP`。以后重新运行基座须在启动后检查业务转发，不能把电脑端健康检查当成手机连通证明。
- 用户已在新基座登录 `bjzs`（张松）。经用户授权，通过 DEV 管理后台为“测试销售”角色新增 `sales:track:own:read`（查询本人当日轨迹），3 个成员生效；授权 71 → 72 项、版本 3 → 4，本部门数据范围不变、无移除项。已核对数据库授权差异及 admin 的 `ROLE_UPDATE / SUCCESS` 审计；前后清单在 `outputs/amap-android/testsales-grants-before.txt`、`testsales-grants-after.txt`。没有直接改表授权。
- 拜访页首次出现 503，复查已恢复正常，今日 0 条记录；未将初次错误当成空数据，也未改写业务记录。当前运行服务实测为 Gateway 26880、IAM 26881、CRM 26883、Sales **26886**（26884 为 ERP），与较早记录中的 Sales 端口不同。
- 真机已加载高德地图瓦片及 11 月 12 日的签到标记，点击标记可选中时间线记录。只有单个位置（或重合位置）时不调用范围自适应，保持街区级缩放；地图隐私图标改为原生可显示的 view/image 容器，依据 DCloud button 不支持嵌套组件的约束（https://doc.dcloud.net.cn/uni-app-x/component/button.html）。
- 本次复现并修复权限刷新导致外勤页持续加载：废弃旧请求后，可见页面重新读取；隐藏页面不发新请求，账号变化清理旧记录。新增权限刷新、切号/退出和单点缩放回归，与已有地图解析用例共 5 项通过；刷新修复 Android/iOS 编译、Harmony 运行包通过，后续 Android 地图显示修正已编译并同步手机。
- 13:36 最终真机复查：bjzs 登录态保留，11 月 12/13 日切换成功；地图道路地名、签到点、标记选中时间线、隐私菜单均正常。读接口成功且没有发起签到/签退/拜访等业务提交。截图 `outputs/amap-android/map-final-today.png`、`map-final-history.png`、`map-settings.png`；日志 `refresh-fix-device.log`。当前样本只有签到位置，服务端返回距离不可计算；完整路线、真实里程、锁屏及断网补传仍待现场验收。
- 公司目前未核实到高德正式技术服务许可；本 Key 用于开发测试，创建成功不代表获得生产商用授权。

### 全屏交互验收（2026-11-13 13:53）

- 地图右上角已替换为四角全屏/收起图标，移除原隐私菜单及关闭地图操作；首次 SDK 同意流程保留。
- `scripts/test-app-fieldwork.cjs` 的 6 项定向测试全部通过，覆盖无坐标时不展开、返回键先收起、切换不重复请求及切号清理全屏状态。
- Android 原生编译、iOS 页面编译、Harmony 运行包制作均通过。日志分别为 `outputs/amap-android/fullscreen-device.log`、`fullscreen-ios.log`、`fullscreen-harmony.log`；iOS/Harmony 仍未启用原生高德地图。
- 最新资源已同步到 Redmi M2007J22C，bjzs 登录态保留。真机验证全屏地图、收起按钮和 Android 返回键，均可回到原日期的记录及内嵌地图；道路地名及签到标记正常显示，切换未新增数据请求，未提交业务数据。
- 真机截图：`outputs/amap-android/fullscreen-expanded.png`（全屏）、`fullscreen-collapsed.png`（图标收起）、`fullscreen-back.png`（返回键收起）。以上为替换原隐私菜单后的最新效果。

### 全屏按钮留白调整（2026-11-13 14:15）

- 按用户反馈将可见白底从 48×48 收紧为 32×32，圆角从 8px 调为 6px；22×22 四角图标保持清晰，外层透明点击区仍为 48×48。白底距地图上、右边缘均为 8px，按压以透明度反馈，不扩大白底。
- 仅调整 `field-route-map.uvue` 的按钮模板与样式。静态审计未发现已知风险，既有外勤 6 项定向测试通过；Android 编译及资源同步、iOS 页面编译、Harmony 未签名运行包制作通过。日志为 `outputs/amap-android/compact-device.log`、`compact-ios.log`、`compact-harmony.log`。Android 启动日志仍有首页既有 label/按钮样式警告，不属于本次按钮修改范围。
- Redmi M2007J22C 已验证内嵌/全屏两种样式、白底外透明热区点击展开、图标点击收起。仍为 bjzs 的 11 月 13 日记录，仅执行页面查看和地图切换，未提交签到、签退或拜访。iOS/Harmony 本次仅编译，仍无原生地图真机验收。
- 截图：`outputs/amap-android/fullscreen-compact-before.png`、`fullscreen-compact-inline.png`、`fullscreen-compact-expanded.png`、`fullscreen-compact-collapsed.png`。

## 真机运行与连接

在仓库根目录使用现有 CLI（`<设备序列号>` 使用 `adb devices -l` 的当前值）：

```sh
/Applications/HBuilderX.app/Contents/MacOS/cli launch app-android --project "$PWD/app" --deviceId '<设备序列号>' --playground custom --customType local
```

运行成功后，在另一终端恢复并检查开发服务连接；重连无线 ADB 或重新运行时也要检查：

```sh
adb -s '<设备序列号>' reverse tcp:26880 tcp:26880
adb -s '<设备序列号>' reverse tcp:26881 tcp:26881
adb -s '<设备序列号>' shell 'curl -sS --max-time 8 http://127.0.0.1:26881/actuator/health'
adb -s '<设备序列号>' shell 'curl -sS --max-time 8 http://127.0.0.1:26880/actuator/health'
```

这是本地联调连接，不是生产 App 的网络方案。生产仍使用已有环境的 HTTPS 域名。
