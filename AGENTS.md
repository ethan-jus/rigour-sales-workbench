# AGENTS.md — 飞书销售 Workbench

## 项目定位

瑞盖优选供应链飞书销售 H5 工作台。
销售在飞书移动客户端中完成拜访、收货跟进和考勤轨迹查看。
不复制后端业务状态机，只消费 Platform API 并管理前端展示状态。

## 技术决策

- Vue 3 + TypeScript + Vite + pnpm，Vant 4 移动端 UI
- Pinia Setup Store，Vue Router createWebHistory
- 飞书 JSAPI 只通过 `IFeishuAdapter` 接口调用，页面层禁止直接访问 `window.tt`

## 现有分层

```
pages/        ← 只管理展示状态和用户输入，不调用 tt
  └── stores/    ← 用 IFeishuAdapter 或 apiClient 获取数据
       ├── adapters/feishu/  ← 唯一访问 window.tt 的代码
       │    ├── real.ts      ← window.tt 顶层真实飞书 JSAPI（callback API）
       │    ├── mock.ts      ← 浏览器 Mock
       │    ├── unsupported.ts ← 生产非飞书阻断
       │    ├── adapter.ts   ← 自动切换工厂
       │    └── jsbridge.ts  ← 官方 JSSDK 注入 + window.h5sdk.config 鉴权
       └── api/core/         ← HTTP Client + 错误处理
```

## 飞书协议对齐

### 免登
- `requestAuthCode()`: callback API `tt.requestAccess({ appID, scopeList: [], success, fail })`
- errno 103 → 自动降级 `tt.requestAuthCode({ appId, success, fail })`
- 返回一次性 code → POST `/api/v1/auth/feishu/exchange` → 后端交换 token + user
- App Secret 不进前端

### 录音
- `tt.getRecorderManager()` 管理 `onStart/onStop/onError` 生命周期并保留 `tempFilePath`
- 单段最长 10 分钟、aac 格式；到达边界自动切片并立即续录，总录音时长不设上限
- `tt.getFileSystemManager().readFile()` 读取临时音频，再使用同源 HTTPS multipart 上传
- `startRecording()` 同步调用，`stopRecording()` 返回 clip 或 null

### 定位
- `tt.getLocation({ type: 'gcj02', timeout, cacheTimeout, accuracy: 'best', success, fail })`
- PC 不支持；前台尽力采样（每 20 分钟）不构成后台持续定位保证，记录中断但不判旷工

### 适配器选择
- `VITE_FEISHU_MOCK=true` → mockAdapter
- 飞书容器内 → realAdapter
- 生产非飞书 → unsupportedAdapter（阻断，禁止静默回落 mock）

## 构建命令

```bash
pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

上述为完整检查参考。依赖未变化时无需重复安装；根据改动范围选择相关检查，跨模块或发布前再进行完整验证。

## 注意事项

- 不提交密钥、密码、Token 到 Git
- API 类型优先从 Platform OpenAPI 生成到 `src/api/generated/`；临时修补时同步修正生成源，避免下次生成覆盖修复。
- 飞书 Adapter 注释说明必要的兼容分支、能力检测和降级原因。
- 可以对本次改动使用 lint 自动修复，检查结果避免夹带无关格式化。

## 工作方式与代码清理

- 围绕用户目标自主实现和重构，可以联动本工作区相关仓库。任务所需的常规 commit/push 无需再次请求许可；先检查分支、远程状态和提交范围，保留其他任务改动，不自动 force-push。
- 替代路径验证后清理相关废弃代码和配置；按影响范围检查引用，涉及跨仓库接口时再检查相关仓库。
- 正在使用的飞书适配器和兼容路径保留，清理已经失效的占位实现。
- 不覆盖其他任务的未提交改动，不改写已执行的数据库迁移。报告实际验证结果，区分 Mock、本地测试和真实飞书验收。

共享环境和部署参考 `../共享DEV研发规范_v1.0.md`；本地开发按实际影响选择流程。
