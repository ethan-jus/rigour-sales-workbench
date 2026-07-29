/**
 * 自动生成 API SDK 的目录入口。
 *
 * 当 Platform 后端提供 OpenAPI 契约后，运行代码生成器将契约输出到此目录。
 * 生成代码禁止手工修改。
 *
 * 生成目录结构预期：
 *   generated/
 *     ├── index.ts          # 导出所有 SDK 模块
 *     ├── auth.ts           # 认证相关 API
 *     ├── sales-work.ts     # 销售工作 API（拜访、考勤、定位等）
 *     ├── delivery.ts       # 配送跟进 API
 *     └── models.ts         # 共享数据模型
 *
 * 当前脚手架阶段，Mock 数据和手写调用在 api/core/ 或 composables 中处理。
 */
export {};
