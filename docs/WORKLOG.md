# 飞书销售 Workbench 实施日志

日期：2026-07-29

## 技术栈

- Vue 3 + TypeScript + Vite + pnpm
- Vant 4 移动端 UI（全局注册，按需使用）
- Pinia 状态管理（Setup Store 语法）
- Vue Router 4（createWebHistory）
- Vitest + happy-dom 测试
- ESLint + Prettier 代码规范

## 项目结构

```
rigour-sales-workbench/
├── docs/
│   ├── WORKLOG.md
│   └── TEST_GUIDE.md
├── public/
│   └── favicon.svg
├── src/
│   ├── adapters/                  # 飞书 Adapter 层
│   │   ├── index.ts               # 统一导出
│   │   └── feishu/
│   │       ├── types.ts            # IFeishuAdapter 接口 + 内部类型
│   │       ├── adapter.ts          # getFeishuAdapter / detectRuntimeContainer
│   │       ├── mock.ts             # Mock 适配器（浏览器/CI）
│   │       ├── real.ts             # 真实飞书 JSAPI 适配器
│   │       ├── unsupported.ts      # 生产非飞书环境阻断适配器
│   │       └── jsbridge.ts         # JSSDK 加载与签名配置
│   ├── api/
│   │   ├── core/
│   │   │   ├── client.ts           # HTTP Client
│   │   │   ├── error.ts            # 统一错误分类
│   │   │   └── index.ts
│   │   └── generated/
│   │       ├── .gitkeep
│   │       └── index.ts
│   ├── bootstrap/
│   │   └── index.ts               # 应用启动引导（容器检测→JSSDK→免登）
│   ├── layouts/
│   │   └── DefaultLayout.vue
│   ├── pages/
│   │   ├── HomePage.vue
│   │   ├── AttendancePage.vue
│   │   ├── VisitPage.vue
│   │   ├── TrackPage.vue
│   │   ├── DeliveryPage.vue
│   │   └── ProfilePage.vue
│   ├── router/
│   │   └── index.ts
│   ├── stores/
│   │   ├── app.ts
│   │   └── auth.ts
│   ├── styles/
│   │   └── global.css
│   ├── types/
│   │   └── index.ts
│   ├── __tests__/
│   │   ├── setup.ts
│   │   ├── adapters/mock.test.ts    # Mock Adapter 测试
│   │   ├── adapters/real-bridge.test.ts  # Real callback bridge 测试
│   │   ├── adapters/unsupported.test.ts  # 阻断适配器测试
│   │   ├── api.test.ts              # API Client + Error 测试
│   │   └── stores.test.ts           # Stores 测试
│   ├── App.vue
│   ├── main.ts
│   └── env.d.ts
├── .editorconfig / .env / .prettierrc
├── eslint.config.js / tsconfig.json / vite.config.ts / vitest.config.ts
├── index.html / package.json
└── README.md
```

## 协议修正记录（2026-07-29）

按主 Agent 审计结论，逐项修正飞书 Adapter 协议：

### 1. requestAccess → callback API + 授权码交换

- `real.ts` 使用顶层 `tt.requestAccess({ appID, scopeList: [], success, fail })`
- errno 103（旧客户端）自动降级 `tt.requestAuthCode({ appId, success, fail })`
- 错误对象兼容 `errno`、`errString`、`errMsg`
- 前端只获取一次性 code，由 `authStore.login()` POST 给后端 `/api/v1/auth/feishu/exchange`
- App Secret 不进前端；参考官方：https://open.feishu.cn/document/web-app/gadget-api/open-ability/login/requestaccess

### 2. startRecord/stopRecord → getRecorderManager

- 使用顶层 `tt.getRecorderManager()`，不再存在伪造的录音接口
- 注册 `onStart`/`onStop`/`onError` 监听器，本地 `startedAt` 计算录音元数据
- 单次最长 10 分钟（600000ms），aac 格式；stop 返回 `localClipId/tempFilePath/duration/startedAt/endedAt`
- 重复 start 幂等忽略；未录音时 stop 返回 null
- 参考官方：https://open.feishu.cn/document/client-docs/gadget/-web-app-api/media/record/getrecordermanager

### 3. getLocation callback 形态

- 按顶层 `tt.getLocation({ type: 'gcj02', timeout: 10, cacheTimeout: 30, accuracy: 'best', success, fail })` 包装
- 权限拒绝/不支持/失败映射为显式中断回调
- PC 不支持；20 分钟前台采样不是后台持续定位保证
- 参考官方：https://open.feishu.cn/document/uYjL24iN/uUTOz4SN5MjL1kzM

### 4. 生产非飞书环境阻断

- `VITE_FEISHU_MOCK=false` 且不在飞书容器 → `unsupportedAdapter` 阻断
- 禁止静默回落 mock，避免伪登录导致数据错乱
- `unsupportedAdapter` 所有操作返回 unsupported 或抛出明确错误

### 5. 移除 sendMessage/showToast/navigateToApproval

- 群消息发送属于后端机器人能力，移除 `sendMessage` 方法
- 审批跳转改为配置或后端返回的 AppLink，移除 `navigateToApproval`
- 这些能力不再出现在 `IFeishuAdapter` 接口中

### 6. JSSDK 加载与签名配置

- `jsbridge.ts`：注入官方 `https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.44.js`
- 后端签名端点 `/api/v1/platform/feishu/jsapi-sign`（当前未实现）
- 使用 `window.h5sdk.config({ appId, timestamp, nonceStr, signature, jsApiList, onSuccess, onFail })`
- 签名端点或 config 失败时 bootstrap 写入错误并 return，不继续免登

### 7. 依赖与构建

- `lint` 脚本移除 `--fix`
- 对齐 Portal 的 Vite 7 / plugin-vue 6 基线，并采用经本仓库门禁验证的 vue-tsc 3

### 8. 测试

- `mock.test.ts`（13 tests）：mock adapter 新接口
- `real-bridge.test.ts`（9 tests）：顶层 window.tt、参数大小写、定位参数、录音临时路径和 destroy 后回调隔离
- `jsbridge.test.ts`（4 tests）：官方 CDN、window.h5sdk.config、ApiResponse.data、鉴权失败和脚本加载超时
- `bootstrap.test.ts`（2 tests）：真实飞书鉴权失败后 return，不继续免登
- `unsupported.test.ts`（11 tests）：阻断适配器所有操作
- `api.test.ts`（7 tests）：API 客户端和错误分类
- `stores.test.ts`（7 tests）：auth 登录/登出/失败路径和 app 状态

## 验收结果

| 步骤 | 命令 | 结果 |
|------|------|------|
| Lint | `pnpm lint` | 零错误 |
| Typecheck | `pnpm typecheck` | 零错误 |
| Test | `pnpm test` | 53 tests passed (7 test files) |
| Build | `pnpm build` | 产出 dist/ |
