# rigour-sales-workbench

瑞盖优选供应链 · 飞书销售 H5 工作台

## 技术栈

- Vue 3 + TypeScript + Vite
- Vant 4（移动端 UI）
- Pinia（状态管理）
- Vue Router
- Vitest + happy-dom

## 飞书兼容设计

- 启动时检测运行容器（飞书/Lark/浏览器）、客户端版本、JSAPI 可用性
- 飞书内使用 `requestAccess` callback API 免登，errno 103 自动降级 `requestAuthCode`
- 前端只获取一次性授权码 code，由后端 `/auth/feishu/exchange` 交换 token
- App Secret 永远不进前端
- 普通浏览器使用 Mock Adapter（`VITE_FEISHU_MOCK=true`），不依赖飞书客户端
- 生产非飞书环境由 `unsupportedAdapter` 阻断，禁止静默回落 mock
- **页面层不得导入飞书 JSAPI 包或访问全局 `tt`**，所有调用只能经过 `Feishu Adapter`
- 客户端 API 位于 `window.tt` 顶层；录音使用 `tt.getRecorderManager()`，单次最长 10 分钟
- 定位使用 `tt.getLocation()`，参数为 `gcj02 + best + timeout/cacheTimeout`；PC 不支持，20 分钟采样只是 H5 前台尽力执行，不保证后台持续定位
- JSSDK 使用官方 `h5-js-sdk-1.5.44.js`，通过 `window.h5sdk.config({ ..., onSuccess, onFail })` 鉴权；失败时启动流程立即阻断
- 页面使用 Hash Router，路由切换只改变 fragment，不破坏按无 fragment URL 计算的 JSSDK 签名

## 目录结构

```
src/
├── adapters/feishu/   # 飞书适配层（real + mock + unsupported + jsbridge）
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

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| VITE_API_BASE_URL | API 前缀 | /api/v1 |
| VITE_ENABLE_MOCK | 启用全局 Mock | true |
| VITE_DEFAULT_TENANT_ID | 默认租户 | demo |
| VITE_APP_ENV | 运行环境 | local |
| VITE_FEISHU_APP_ID | 飞书应用 ID | (空) |
| VITE_FEISHU_MOCK | 飞书 Mock 模式 | true |

仓库保留 `.env`、`.env.development`、`.env.production` 作为 Vite 模式默认值，并提供
`.env.example` 作为配置模板。这些文件只能包含非敏感开关、路径和空 App ID；所有 `VITE_*`
都会进入浏览器产物，禁止填写 App Secret、访问令牌、密码或其他密钥。本机覆盖请使用未提交的
`.env.local` / `.env.*.local`。

## 命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 启动开发服务器
pnpm build            # 类型检查 + 生产构建
pnpm lint             # ESLint 检查（无 --fix）
pnpm format           # Prettier 格式化
pnpm typecheck        # TypeScript 类型检查
pnpm test             # 运行测试
```

## 约束

- 不复制订单、库存、考勤、薪酬等业务状态机，只消费 Platform API
- 页面只管理展示状态和用户输入，业务判定由所属后端领域服务完成
- 所有飞书能力只能通过 `getFeishuAdapter()` → `IFeishuAdapter` 调用
- 密钥、App Secret 等不得进入 `VITE_*` 或提交到 Git
