# AGENTS.md — 销售 Workbench

## 适用范围

本文件中的H5、Vue/Vant、Pinia、Vue Router、Capacitor 相关技术约定适用于旧 `src/` 及其配套工程。原生 uni-app x 工程位于 `app/`，修改前先读取 [app/AGENTS.md](app/AGENTS.md)，以该目录的技术约定和验收命令为准；本文件中的通用工作方式、凭据保护和共享环境规则仍适用。

## 项目定位

瑞盖优选供应链销售工作台。
销售通过作业 App 完成拜访、收货跟进和考勤轨迹查看。
不复制后端业务状态机，只消费 Platform API 并管理前端展示状态。

## 技术决策

- Vue 3 + TypeScript + Vite + pnpm，Vant 4 移动端 UI
- Pinia Setup Store，Vue Router createWebHistory
- H5 生产登录使用平台 OIDC 和 PKCE。原生 uni-app x 通过平台账号登录。
- 页面通过 `src/adapters/workbench` 获取定位、拍照和录音能力。浏览器 Mock 仅在开发构建且显式启用时生效。

定位中断应记录原因，业务规则通过服务端核定。录音片段在上传成功后按既有流程清理。

## 构建命令

```bash
pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

上述为完整检查参考。依赖未变化时无需重复安装；根据改动范围选择相关检查，跨模块或发布前再进行完整验证。

## 注意事项

- 不提交密钥、密码、Token 到 Git
- API 类型优先从 Platform OpenAPI 生成到 `src/api/generated/`；临时修补时同步修正生成源，避免下次生成覆盖修复。
- 可以对本次改动使用 lint 自动修复，检查结果避免夹带无关格式化。

## 工作方式与代码清理

- 用户 2026-11-11 明确要求：只在本日常项目目录开发；功能隔离可以切换 Git 分支，不新建工程副本或 worktree，不再使用 `.codex/worktrees/rigour-sales-workbench-app-g0`。HBuilderX 使用本仓库的 `app/`。只使用用户现有的主项目 IDEA 运行项，不自行后台启动另一套 JAR 或创建重复运行配置；需要重启本地服务时告知具体服务，由用户操作。

- 围绕用户目标自主实现和重构，可以联动本工作区相关仓库。任务所需的常规 commit/push 无需再次请求许可；先检查分支、远程状态和提交范围，保留其他任务改动，不自动 force-push。
- 替代路径验证后清理相关废弃代码和配置；按影响范围检查引用，涉及跨仓库接口时再检查相关仓库。
- 清理失效的占位实现，保留作业 App 仍使用的接口。
- 不覆盖其他任务的未提交改动，不改写已执行的数据库迁移。报告实际验证结果，区分 Mock、本地测试和作业 App 真机验收。

共享环境和部署参考 `../共享DEV研发规范_v1.0.md`；本地开发按实际影响选择流程。
