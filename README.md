# rigour-sales-workbench

瑞盖优选供应链 · 销售工作台 App / H5

本应用是销售人员唯一移动执行端：自研签到/签退、工作期间定位、CRM客户门店选择、现场拜访、录音、内部沟通、语音会议和本人申诉。Portal中的“销售管理/销售管控台”负责后台管理，不在PC端复制现场作业。

## 技术栈

- Vue 3 + TypeScript + Vite
- Vant 4（移动端 UI）
- Pinia（状态管理）
- Vue Router
- Capacitor（iOS/Android 原生容器）
- LiveKit Client（自托管会议入会）
- Vitest + happy-dom

## 运行入口与能力适配

- 生产 App 主入口为 Capacitor iOS/Android，登录使用 `VITE_AUTH_MODE=oidc`
- App 通过 `WorkbenchCapabilities` 统一定位、拍照、录音；页面不得直接耦合 Capacitor 插件
- 飞书 H5 仅作为兼容入口保留：飞书内使用 `requestAccess` callback API 免登，errno 103 自动降级 `requestAuthCode`
- 前端只获取一次性授权码 code，由后端 `/auth/feishu/exchange` 交换 token；App Secret 永远不进前端
- 普通浏览器仅在 `VITE_FEISHU_MOCK=true` 时使用 Mock Adapter
- 生产非 App / 非飞书环境由 `unsupportedAdapter` 阻断，禁止静默回落 mock
- **页面层不得导入飞书 JSAPI 包、访问全局 `tt` 或直接访问 Capacitor 原生插件**，所有调用只能经过 Adapter
- 客户端 API 位于 `window.tt` 顶层；录音使用 `tt.getRecorderManager()`，单段10分钟自动切片续录，总时长不限
- 临时音频通过 `tt.getFileSystemManager().readFile()` 读取，再用同源 HTTPS multipart 上传
- 定位使用 `tt.getLocation()`，参数为 `gcj02 + best + timeout/cacheTimeout`；PC 不支持，20 分钟采样只是 H5 前台尽力执行，不保证后台持续定位
- JSSDK 使用官方 `h5-js-sdk-1.5.44.js`，通过 `window.h5sdk.config({ ..., onSuccess, onFail })` 鉴权；失败时启动流程立即阻断
- 页面使用 Hash Router，路由切换只改变 fragment，不破坏按无 fragment URL 计算的 JSSDK 签名

## App 与内部协作

- App 打包走 Capacitor，共享 Vue3/Vant 业务页面；当前 iOS Bundle ID 和 Android applicationId 均为 `com.rigour.workbench`，App 名称为“门户工作台”
- App 生产登录设置 `VITE_AUTH_MODE=oidc`，通过系统浏览器执行 OIDC Authorization Code + PKCE；不把 client secret 放入前端
- 原生 App 通过 Keychain/Android Keystore 插件保存 token；Web/测试环境保留 localStorage 兼容
- 原生 App 启动时默认强制获取一次当前位置；如果系统定位关闭、用户拒绝授权或当前定位不可用，启动流程阻断
- 进行中工作日会恢复原生定位会话，采样周期优先采用 Sales Work 后端下发的 `fieldPolicy.locationIntervalMinutes`
- 当前 Capacitor Geolocation 只覆盖前台/应用活跃期稳定采样；真正后台持续轨迹需 Android Foreground Service 与 iOS Background Modes/Always 授权单独实现和真机验收
- 原生录音使用 `@independo/capacitor-voice-recorder`，支持 Capacitor 8 的 iOS Swift Package Manager 和 Android
- `src/adapters/mobile/` 封装设备 ID、推送 Token 和通知点击，页面不得直接耦合 APNs/FCM/厂商推送实现
- `src/stores/collaboration.ts` 按“REST 拉取事实 + WebSocket 接收事件 + clientMessageId 幂等发送”管理 IM 状态
- IM 页面包括会话列表、通讯录发起单聊、建群、文本、附件、@人、撤回、未读和会议入口
- 会议页通过后端签发的短期 LiveKit Token 连接自托管 LiveKit；第一版支持语音、麦克风开关和 1 路屏幕共享入口
- iOS 屏幕共享仍需 ReplayKit Broadcast Extension，Android 屏幕共享仍需 MediaProjection 原生桥接；这部分不属于纯 Vue 代码能力

## 角色与后台配置

- App 不在前端硬编码“销售角色名”，而是登录后读取 IAM `/me` 与 `/portal/navigation/{applicationCode}` 的角色、权限和菜单资源
- `src/features/catalog.ts` 将后台 `routeKey` / `permission_code` 映射为前端功能开关
- 拥有销售权限的用户看到首页、外勤考勤、客户门店、拜访打卡、工作记录等能力
- 只拥有协作权限的用户只看到内部沟通和个人中心
- 后续新增角色功能时，优先在 IAM 增加资源、权限和 routeKey，再在前端 Feature Catalog 增加映射，避免在页面里写死角色判断

## 目录结构

```
src/
├── adapters/feishu/   # 飞书适配层（real + mock + unsupported + jsbridge）
├── adapters/mobile/   # App 设备、推送和通知点击适配层
├── adapters/workbench/ # App/飞书/Mock 运行能力选择与定位拍照录音适配层
├── api/               # API 客户端 + 生成目录
├── bootstrap/         # 应用启动引导
├── layouts/           # 布局组件
├── pages/             # 页面组件
├── router/            # 路由配置
├── stores/            # Pinia 状态
├── styles/            # 全局样式
├── types/             # 类型定义
└── __tests__/         # 单元测试
```

当前页面骨架包括今日工作台、外勤考勤、客户门店、四阶段拜访执行、录音证据、轨迹/拜访/证据记录、内部沟通、语音会议、配送跟进、当前规则、补卡申诉、隐私授权和个人中心。生产环境未接入Sales Work命令接口前，签到页不会生成本地伪考勤；浏览器Mock只用于验证飞书能力和交互结构。

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| VITE_API_BASE_URL | API 前缀 | /api/v1 |
| VITE_WS_BASE_URL | WebSocket 入口；未配置时跟随当前页面 origin 并自动切换 ws/wss | (空) |
| VITE_API_TARGET | Vite开发代理使用的Gateway地址；换服务器时在`.env.local`覆盖 | http://localhost:26880 |
| VITE_ENABLE_MOCK | 启用全局 Mock | true |
| VITE_DEFAULT_TENANT_ID | 默认租户 | demo |
| VITE_APP_ENV | 运行环境 | local |
| VITE_AUTH_MODE | 登录模式：feishu / oidc / mock | 跟随 VITE_FEISHU_MOCK |
| VITE_OIDC_ISSUER | OIDC Issuer；App 模式必填 | (空) |
| VITE_OIDC_CLIENT_ID | OIDC 公共客户端 ID；App 模式必填 | (空) |
| VITE_OIDC_REDIRECT_URI | OIDC 回调地址；原生 App 应配置自定义 scheme/deep link | 当前页面地址 |
| VITE_OIDC_SCOPE | OIDC scope | openid profile |
| VITE_WORKBENCH_APPLICATION_CODE | IAM 导航应用编码；历史兼容暂用 FEISHU_SALES | FEISHU_SALES |
| VITE_REQUIRE_LOCATION_ON_BOOT | 启动时是否强制获取定位；App 生产应为 true | true |
| VITE_FEISHU_APP_ID | 飞书应用 ID | (空) |
| VITE_FEISHU_MOCK | 飞书 Mock 模式 | true |

仓库保留 `.env`、`.env.development`、`.env.production` 作为 Vite 模式默认值，并提供
`.env.example` 作为配置模板。这些文件只能包含非敏感开关、路径和空 App ID；所有 `VITE_*`
都会进入浏览器产物，禁止填写 App Secret、访问令牌、密码或其他密钥。本机覆盖请使用未提交的
`.env.local` / `.env.*.local`。

## 命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 启动开发服务器；日志会列出localhost和当前网卡lanUrls
pnpm build            # 类型检查 + 生产构建
pnpm lint             # ESLint 检查（无 --fix）
pnpm format           # Prettier 格式化
pnpm typecheck        # TypeScript 类型检查
pnpm test             # 运行测试
pnpm cap:sync         # 构建Web产物并同步到已生成的iOS/Android工程
pnpm cap:add:ios      # 生成iOS工程（确认签名和Bundle ID后执行）
pnpm cap:add:android  # 生成Android工程（确认包名和签名后执行）
pnpm cap:open:ios     # 用 Xcode 打开 iOS 工程
pnpm cap:open:android # 用 Android Studio 打开 Android 工程
pnpm android:apk:debug # 构建 Android debug APK，需本机已安装 Android SDK
```

Android APK 构建要求本机配置 `ANDROID_HOME`，或在未提交的 `android/local.properties`
写入 `sdk.dir=/你的/Android/sdk`。iOS 上架前还需要 Apple Developer Team、签名证书、
Provisioning Profile、APNs 能力和 App Store Connect 应用记录。

## 约束

- 不复制订单、库存、考勤、薪酬等业务状态机，只消费 Platform API
- H5打卡和拜访事实由Sales Work主写；CRM主写客户门店，HR主写正式考勤结果
- App 打开时可以为准入控制强制获取一次当前位置；持续轨迹只在 Sales Work 确认签到后开始、签退后停止
- 页面只管理展示状态和用户输入，业务判定由所属后端领域服务完成
- 所有飞书能力只能通过 `getFeishuAdapter()` → `IFeishuAdapter` 调用
- 所有 App 原生能力只能通过 `getWorkbenchCapabilities()` → `WorkbenchCapabilities` 调用
- 密钥、App Secret 等不得进入 `VITE_*` 或提交到 Git
