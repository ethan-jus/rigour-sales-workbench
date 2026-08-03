# AGENTS.md — 飞书销售 Workbench

## 项目定位

瑞盖优选供应链飞书销售 H5 工作台。
销售在飞书移动客户端中完成拜访、收货跟进和考勤轨迹查看。
不复制后端业务状态机，只消费 Platform API 并管理前端展示状态。

## 技术决策

- Vue 3 + TypeScript + Vite + pnpm，Vant 4 移动端 UI
- Pinia Setup Store，Vue Router createWebHistory
- 飞书 JSAPI 只通过 `IFeishuAdapter` 接口调用，页面层禁止直接访问 `window.tt`

## 分层约束

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
- 单次最长 10 分钟，mp3 格式
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

## 注意事项

- 不提交密钥、密码、Token 到 Git
- API 类型从 Platform OpenAPI 生成到 `src/api/generated/`，禁止手改
- 飞书 Adapter 注释须说明兼容分支、能力检测和降级原因
- lint 不带 `--fix`

## 代码生命周期（断舍离）

废弃页面、组件、路由、权限资源、配置、接口封装、测试和资源，在替代路径验证后直接删除；不得用注释代码、禁用配置、旧目录或重复入口暂存。删除前后都要在三个仓库检索引用，并通过类型检查、lint、测试和构建。正在使用的飞书能力适配器可以保留，纯占位或已弃用适配器必须删除；后端已执行的 Flyway 迁移文件不得改写。

统一规则见：`../共享DEV研发规范_v1.0.md` 的“代码与配置生命周期（断舍离）”。
