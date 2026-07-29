# 测试指南

## 运行命令

```bash
pnpm test           # 运行所有测试
pnpm test:watch     # 监听模式
pnpm lint           # ESLint 检查
pnpm typecheck      # TypeScript 类型检查
pnpm build          # 生产构建
```

## 测试框架

- **Vitest** + **happy-dom**
- 测试文件放在 `src/__tests__/` 目录下，命名 `*.test.ts`
- 不测试 `.vue` 组件渲染（核心逻辑在 adapter/composables/stores 的纯逻辑中测试）

## 测试范围

### Adapter 层

- `ContainerDetector`：各种 UA 字符串的环境检测
- `MockAdapter`：所有能力的 Mock 返回值
- `FeishuPort`：初始化、Mock 模式切换、能力访问器

### API 层

- `apiClient`：请求头构造、错误响应分类
- `normalizeError`：各类异常的规范化分类

### Stores

- `authStore`：登录/登出状态流转
- `feishuStore`：初始化状态
- `locationStore`：点位添加、状态切换、重置
- `audioStore`：片段管理、录音状态

## 环境变量 Mock

测试中通过 `vi.stubEnv` 或 Vitest 的 `env` 配置来模拟 `import.meta.env`。

## 飞书 JSAPI Mock

`tt` 全局对象在测试中如果需要模拟，在 `beforeEach` 中注入 mock。
