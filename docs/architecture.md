# 飞书销售 Workbench 架构说明

## 模块职责

### adapters/feishu/ — 飞书适配层

- `types.ts`：`IFeishuAdapter` 接口定义，所有飞书能力通过此接口暴露。与官方 JSAPI 对齐：
  - `requestAuthCode()` 替代旧 `getIdentity()`，返回一次性 code 供后端交换
  - `startRecording()` 同步调用，内部使用 `tt.getRecorderManager()` 管理生命周期
  - 移除 `navigateToApproval()` 和 `sendMessage()`（前端不处理审批跳转和消息发送）
- `adapter.ts`：`getFeishuAdapter()` 工厂，三路选择：
  - `VITE_FEISHU_MOCK=true` → `mockAdapter`
  - 飞书容器内 → `realAdapter`
  - 生产非飞书环境 → `unsupportedAdapter`（阻断，禁止静默回落 mock）
- `real.ts`：真实飞书 JSAPI 封装，**唯一一处**访问 `window.tt` 的代码
  - `requestAuthCode`: `tt.requestAccess({ appID, scopeList: [] })`，errno 103 降级 `tt.requestAuthCode({ appId })`
  - `getLocation`: `tt.getLocation` 使用 gcj02、best 精度和显式 timeout/cacheTimeout
  - `getRecorderManager()`: 管理 `onStart/onStop/onError`，返回 localClipId 与 tempFilePath，时长为本地计算的毫秒值
- `mock.ts`：浏览器 Mock 实现，仅在 `VITE_FEISHU_MOCK=true` 时可用
- `unsupported.ts`：生产非飞书环境阻断适配器，所有操作返回 unsupported 或抛出阻断错误
- `jsbridge.ts`：加载官方 `h5-js-sdk-1.5.44.js`，调用 `window.h5sdk.config({ ..., onSuccess, onFail })`；失败时 bootstrap 直接阻断

**依赖方向**：页面 → `IFeishuAdapter` 接口 → adapter 工厂 → real/mock/unsupported 实现。页面层禁止访问 `window.tt`。

### api/core/ — HTTP 客户端层

- `client.ts`：`apiClient` 封装 fetch，自动注入 `Authorization`、`X-Tenant-Id`、`X-Request-Id`、`Accept-Language` 请求头
- `error.ts`：`normalizeError()` 分类为 `NETWORK`、`AUTH`、`FORBIDDEN`、`BUSINESS`、`UNKNOWN`

### bootstrap/ — 应用启动引导

`bootstrap()` 执行顺序：
1. 容器检测
2. 飞书容器内注入官方 JSSDK，并用 `window.h5sdk.config` 鉴权；失败则写启动错误并 return
3. 免登获取授权码 → 后端 `/auth/feishu/exchange` 交换 token
4. 记录启动状态

### router/ — 页面路由

- 使用 Hash Router。JSSDK 签名按去除 fragment 的页面 URL 计算，页面内切换路由不会改变签名基准。
- 直接刷新子页面不依赖 Nginx 或 CDN 的 SPA fallback，降低飞书工作台入口部署复杂度。

### stores/ — 状态管理

- `app.ts`：应用全局状态（运行环境、启动就绪/错误）
- `auth.ts`：用户认证状态，`login()` 流程：
  - Mock 模式：`requestAuthCode()` → 使用固定 mock 身份
  - 真实模式：`requestAuthCode()` → POST `/api/v1/auth/feishu/exchange` → 存储 token + user

### pages/ — 页面组件

- `HomePage`：工作台，展示环境信息和快捷入口
- `AttendancePage`：考勤页，内嵌定位采样和中断计数
- `VisitPage`：拜访页，录音功能入口（`startRecording()` 同步 + `stopRecording()` 异步）
- `TrackPage`：轨迹页骨架
- `DeliveryPage`：配送跟进骨架
- `ProfilePage`：个人页，用户信息展示和登出

## 授权码交换边界

```
前端 getFeishuAdapter().requestAuthCode()
  → tt.requestAccess({ appID, scopeList: [], success, fail })
  → errno 103时降级 tt.requestAuthCode({ appId, success, fail })
  → 返回一次性 code
  → POST /api/v1/auth/feishu/exchange { code }
  → 后端返回 { token, user: { userId, name, avatar, tenantId }, feishuOpenId }
  → 前端存储 token + user 信息
```

App Secret 永远不进前端。

## 定位与录音边界

- `getLocation` 和 `getRecorderManager` 均不支持飞书 PC 端。
- 每 20 分钟定位是 H5 页面处于前台且 WebView 仍存活时的尽力采样，不是后台持续定位保证。
- `RecorderManager.start.duration` 与 Adapter 返回的 `duration` 都使用毫秒；官方 onStop 仅保证
  `tempFilePath`，因此返回时长由本地 `startedAt`/`endedAt` 计算。
- `localClipId` 只用于前端关联上传任务，不是飞书 fileId；上传层必须使用 `tempFilePath` 读取文件。

## 运行方式

```bash
pnpm dev              # 开发（Mock 模式）
pnpm build            # 生产构建
pnpm lint             # ESLint 检查（无 --fix）
pnpm typecheck        # TypeScript 类型检查
pnpm test             # 运行测试
```

## 当前未实现范围

- 真实后端 API 集成（依赖 Platform 服务就绪）
- 高德地图轨迹可视化
- 录音 SHA-256 指纹计算和上传
- AI 初审状态集成
- 审批跳转真实参数对接
- BI 战报集成
- 后端 JSSDK 签名端点（`/api/v1/platform/feishu/jsapi-sign`）
- 离线缓存和 PWA
