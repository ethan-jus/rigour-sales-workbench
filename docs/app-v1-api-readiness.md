# 销售工作台 App V1 接口就绪审查

核查时间：2026-10-14。仅核对 Platform 当前本地源码，未调用生产接口、未读取凭据、未执行数据库或生产写操作。本文是原生页面实现的接入边界，不代表任何环境已完成联调。原 G0 Sales 详细合同见 `app-g0-platform-contract.md`。

## 1. 当前可实施边界

- App 复用平台 Gateway、IAM 和各领域服务；不创建独立账号库，不复制业务状态机。服务器仍决定功能权限和数据范围。
- 本轮可实现正式原生页面、真实只读接口客户端、明确的未登录/无权限/无数据/失败状态，以及本机草稿。未具备完整合同的写动作不能显示“提交成功”。
- Sales 的 `/me/*` 查询确实由服务端限制为本人。CRM、Order、BI 的普通查询按平台授权范围读取，可能是本人、部门、地区或全部；页面不能一律叫“我的”，不能靠请求中附带 `ownerEmployeeCode` 代替服务端授权。
- 商品管理 `erp:product:read` 同时能读含进价的详情。App 只调用不含规格的列表能避免页面主动拉取进价，但不是服务端字段授权。面向普通销售开放前仍需销售商品专用 DTO/权限，不应仅靠前端隐藏解决。

## 2. 身份与网络

### 已有能力

- IAM 支持 PUBLIC Client 的 Authorization Code + PKCE、Refresh Token 轮换。
- `GET /api/v1/me` 返回裸 `CurrentUserView`：`id, tenantId, tenantName, principalScope, username, displayName, roles[], permissions[]`。Sales/CRM/ERP/Order/BI 通常为 `ApiResponse`：`{code:"OK",message,data,requestId,timestamp}`。
- 业务 API 用 `Authorization: Bearer <access_token>`，不使用 ID Token，不伪造 `X-Rigour-*` 身份头。租户由可信认证上下文确定。
- `/login` 是 Spring Security HTML 表单和 CSRF 登录；`/scdp/session` 只返回浏览器会话及 CSRF 状态。没有查到可直接供 App 提交用户名密码换 Token 的 JSON API。

### 移动登录仍缺什么

- 未查到移动端 Client ID 与 `com.rigour.workbench://auth/callback` 的注册迁移；旧 `.env.example` 的 issuer/clientId 为空。不能将文档示例当作已启用客户端。
- `ScdpClientBootstrapProperties` 默认 `rigour-scdp-browser`，只接受精确 HTTPS 或显式允许的 DEV HTTP 回调，不能直接注册自定义 App scheme。
- `ScdpClientBootstrapCommand` 注册 `none` 客户端认证、code + refresh、openid/profile、15 分钟 Access Token、7 天轮换 Refresh Token。V109 仅给现有 `rigour-scdp-*` PUBLIC 客户端补 refresh grant。
- 三端必须完成系统浏览器唤起、精确回调匹配、冷启动回调、加密随机 state/verifier、S256、state 单次消费与超时、安全令牌存储。不能保存密码、Token 至普通 storage、日志或诊断导出。
- 可评估不申请 `openid` 的 OAuth Code + PKCE 模式，只申请真实客户端允许的非 OIDC scope（如 `profile`），把 Access Token 当作不透明值交给可信 HTTPS Gateway，再通过 `/me` 确认身份；需真实环境验证该 scope 组合。不能称此路径已完成 OIDC 验证。若申请 `openid` 并使用 ID Token，必须校验签名、iss、aud、nonce，不能只解码 JWT。

## 3. 可复用的只读接口

以下地址均相对 Gateway；除 `/me` 外先解包 `data`。CRM/ERP/Order 分页统一 `{total, begin, step, items}`，`begin` 是 0/20/40 的记录偏移。Sales 分页是 `{total,page,pageSize,items}`，`page` 从 1 开始。

| 页面 | 路径、参数 | 权限与字段 |
|---|---|---|
| 客户列表 | `GET /api/v1/crm/internal-customers?begin=0&step=20&customerName=` | `crm:customer:read`；`id(Long),customerName,contactName,contactPhone,cityName,regionName,statusCode,customerTypeCode,ownerEmployeeCode` |
| 客户详情 | `GET /api/v1/crm/internal-customers/{id}` | 同上，额外 `address,remark` 等；不是 UUID 版 `/crm/customers` |
| 收货地址 | `GET /api/v1/crm/internal-customers/{id}/shipping-addresses` | `crm:customer:read`；data 数组：`id(UUID),consignee,contact,phone,regionText,addressDetail,fullAddress,defaultAddress,revision` |
| 商品列表 | `GET /api/v1/erp/product-management/products?begin=0&step=20&productName=&withVariants=false` | `erp:product:read`；`id,productName,productCode,productSpecification,unitCode,mainImageUrl,defaultSalePrice,shelfStatusCode,submitStatusCode,variantCount`；默认价只能标参考价，未返回库存 |
| 订单列表 | `GET /api/v1/orders/sales?begin=0&step=20&customerName=&orderNo=&orderStatusCode=&orderDateFrom=&orderDateTo=` | `order:read`；`id,orderNo,customerId,customerNameSnapshot,contactPhoneSnapshot,orderDate,orderStatusCode,paymentStatusCode,outboundStatusCode,payableAmount,paidAmount,unpaidAmount,revision` |
| 订单详情 | `GET /api/v1/orders/sales/{id}` | `order:read`；额外 `lines[],remark,paymentAttachments[]` |
| 回款记录 | `GET /api/v1/orders/sales-payments?begin=0&step=20&salesOrderNo=&paymentTimeFrom=&paymentTimeTo=` | ACTIVE 授权使用 `order:payment:read`，旧模式回退 `order:read`；受关联订单范围限制。仅阅读，非销售申请列表 |
| 本人销售上下文 | `GET /api/v1/sales/me/context` | `sales:context:read`；`userId,employeeId,salesProfileId,salesNo,cityOrgId,profileStatus,permissions,fieldPolicy` |
| 本人负责门店 | `GET /api/v1/sales/me/visit-targets?q=&page=1&pageSize=20` | `sales:visit-target:read`；`projectionId,targetType,customerId(UUID),storeId(UUID),customerName,storeName,storeAddress,longitude,latitude,storeStatus` |
| 本人拜访列表 | `GET /api/v1/sales/me/visits?date=YYYY-MM-DD&page=1&pageSize=20` | `sales:visit:own:read`；不支持 from/to 区间；列表 checkpoints 为空 |
| 本人拜访详情 | `GET /api/v1/sales/me/visits/{visitId}` | 同上；`targetSnapshot` 含门店地址和位置；checkpoints 含 `longitude,latitude,accuracyMeters,distanceToTargetMeters,clientOccurredAt` |
| 本人拜访汇总 | `GET /api/v1/sales/me/activity-summary?from=YYYY-MM-DD&to=YYYY-MM-DD` | `sales:visit:own:read`；总/完成/进行中/有效/待复核/初访/复访/去重门店数 |
| 拜访计划 | `GET /api/v1/sales/me/visit-plans?date=YYYY-MM-DD` | 使用正式计划合同，不能将演示待办当作已下发计划 |
| 录音元数据 | `GET /api/v1/sales/me/visits/{id}/recordings` | `sales:recording:own:read`；`clipCount,uploadedTotalDurationMs,verifiedTotalDurationMs,clips[]`；无播放 URL |
| 照片元数据 | `GET /api/v1/sales/me/visits/{id}/evidence` | `sales:evidence:own:read`；照片数量及证据元数据；无图片/缩略图 URL |
| BI 范围 | `GET /api/v1/analytics/supply-dashboard/effective-scope` | `analytics:dashboard:read`；获取当前有效范围，不是单独的 App 权限总表 |
| 经营分析 | `GET /api/v1/analytics/supply/dashboard/sales-analysis?from=&to=&regionCode=&ownerStaffCode=` | `analytics:dashboard:read`，有服务端授权条件；具体金额口径不可替换成“本期到账” |
| 员工业绩 | `GET /api/v1/analytics/supply/dashboard/employees?from=&to=&regionCode=&ownerStaffCode=` | 同上；`employees[].employeeCode,employeeName,customerCount,orderCount,salesAmount,paidAmount`，不是实时个人提成 |

订单明细：`id,lineNo,productId,productVariantId,productNameSnapshot,skuCodeSnapshot,specificationSnapshot,unitCode,quantity,unitPrice,discountAmount,lineAmount`。接口时间传带时区 ISO，页面统一显示北京时间 `yyyy-MM-dd HH:mm:ss`；不要破坏 API 时区。未知数量、价格和库存显示未提供，不回填 0。

## 4. 不可混用的身份和状态

- Sales 门店合同的 customerId/storeId 是 UUID；CRM 内部客户、ERP 商品、Order 订单使用 Long。当前没有查到可供 App 直接使用的统一客户门店映射合同。选中的 CRM Long customerId 不能传给 Sales 创建拜访。
- Long 的传输与精度：上述三个内部实体使用 `@TableId(type = IdType.AUTO)`；当前列表/详情 DTO 的 Long 字段无字符串序列化注解，也未查到全局 Long 转字符串的 Jackson 定制，按源码默认输出 JSON number，并非 Snowflake ID 模型。本轮未检查运行环境报文及数据库最大值，不能保证永远小于 JavaScript 安全整数上限。App 应优先保留字符串 ID；数字 ID 只接受正整数且不大于 `9007199254740991`，超出时明确阻断关联/详情操作，不能把已经失精的 number 转成 string 后继续使用。后续移动专用合同建议明确用十进制字符串 ID。
- 客户：`ACTIVE=启用`、`INACTIVE=停用`。
- 订单：`DRAFT=草稿`、`SUBMITTED=已提交`、`COMPLETED=已完成`、`CANCELLED=已取消`。不能把 SUBMITTED 强行显示为原型的“待审核”，当前状态机没有独立审批状态。
- 收款：`UNPAID=未收款`、`PARTIAL_PAID=部分收款`、`PAID=已收款`、`CANCELLED=已取消`。
- 出库：`PENDING=待出库`、`PARTIAL_OUT=部分出库`、`OUT_CONFIRMED=已出库`。出库不等于签收。
- 拜访到店/离店状态和 `reviewStatus` 分开；已到店不等于有效拜访。录音片段数不等于“有录音的拜访数”。

## 5. 写能力缺口与下一步

| 能力 | 现有合同及限制 | 应先补齐 |
|---|---|---|
| 移动开单 | `POST /orders/sales` 接受含价格、折扣、归属和来源字段的 `SalesOrderCommand`；总额由传入单价计算；查到单位/金额格式/范围校验，未见移动报价令牌和重复提交幂等合同；无 checkout 收货地址字段 | 销售报价/规格可售/客户价格与地址校验；服务端绑定归属，幂等请求标识；不能借管理 DTO 假装全部就绪 |
| 商品详情 | `ProductVariantManagementView.purchasePrice`、详情 `sourceFields` 原样返回 | 服务端只含销售可见字段的 DTO，按客户计算报价。即使 UI 不展示进价，宽泛 read 权限依然能请求详情 |
| 回款提报 | `POST /orders/sales-payments` 直接持久化回款，`refreshOrderPayment` 汇总 RECEIVED/CHECKED 并更新订单已收/未收及状态 | 销售提报→财务确认合同；避免把“提报待审核”映射为实际入账 |
| 退货申请 | 现有退款/库存状态机并不等于移动端“申请退货”完整流程 | 申请、审核、退货入库与退款分离；本轮仅本机草稿不能算已申请 |
| 开始拜访 | 需要真实 ACTIVE 工作日；`POST /sales/work-days/check-in` 会创建签到事实，不能静默作为读取准备步骤 | 显式工作日流程，或后端明确改变该业务前置；不能客户端伪造 workDayId |
| 200 米打卡 | 后端按生效 Visit Policy 半径校验；LocationEvidence 缺坐标系/独立采样时间/地址快照 | WGS84/GCJ02 坐标统一，位置新鲜度和详细地址合同；校验必须在服务端。不能将 GPS 原始点与高德门店点直接混算 |
| 地图和地址 | `nearby-stores` 仍是 AmapPoiClient，高德查询；不存在已完成天地图替换 | 独立地图提供方合同、key 和配额；原生 GPS 仅提供坐标事实，地图/地址分别接入 |
| 长录音 | multipart `/recordings/clips` 每段 `durationMs<=600000`；按配置拒绝不足业务最小时长的录音；上传读完整 bytes；没有传输级断点续传 | 业务长录音与传输分片分离；本机持久化、恢复队列、内容校验、重试及服务端确认；短传输分片不能直接套用业务短录音丢弃规则 |
| 远程媒体回看 | RecordingClipView/VisitPhotoEvidenceView 无播放/缩略图 URL | 在本人范围校验后返回短期媒体访问地址或受控流接口；不可从 COS key 拼公共 URL |
| 个人提成 | HR 有 `/api/v1/hr/payroll` 及数据范围控制，但包含工资/社保等薪资信息；无独立的销售个人提成轻量合同 | 本人提成 DTO，明确预估/已确认/已发放及日期口径，不将 BI 销售额直接乘比例 |

## 6. 源码索引和验收

Platform 根：`06_代码工程/rigour-supply-chain-digital-platform`。

- IAM：`services/rg-scdp-iam/iam-server/src/main/java/com/rigour/tenant/iam/infrastructure/bootstrap/ScdpClientBootstrap{Properties,Command}.java`；`api/controller/auth/{AuthController,ScdpSessionController}.java`；`infrastructure/security/oidc/JdbcRegisteredClientRepository.java`。
- CRM：`services/rg-scdp-crm/crm-api/src/main/java/com/rigour/merchant/api/v1/CrmInternalCustomerApi.java`；`crm-server/.../infrastructure/persistence/repository/CrmDataScope.java`。
- ERP：`services/rg-scdp-erp/erp-api/src/main/java/com/rigour/erp/api/v1/ErpProductManagementApi.java` 与 `model/ProductVariantManagementView.java`；`erp-server/.../application/service/product/ErpProductManagementService.java`。
- Order：`services/rg-scdp-order/order-api/src/main/java/com/rigour/order/api/v1/{OrderSalesOrderApi,OrderSalesPaymentRecordApi}.java`；`order-server/.../application/service/sales/OrderSalesOrderService.java`；`infrastructure/persistence/repository/{OrderDataScope,MybatisPlusSalesPaymentRecordRepository}.java`。
- Sales：`services/rg-scdp-sales/sales-api/src/main/java/com/rigour/sales/api/v1/{SalesWorkApi.java,model/SalesWorkApiModels.java}`；`sales-server/.../application/service/SalesWorkRecordingService.java`。
- BI：`services/rg-scdp-bi/bi-server/src/main/java/com/rigour/analytics/application/service/BiDataScopeService.java`；`infrastructure/persistence/scope/{BiScopePredicates,BiAuthorityFilter}.java`。
- HR：`services/rg-scdp-hr/hr-api/src/main/java/com/rigour/hr/api/v1/HrPayrollApi.java`；`hr-server/.../infrastructure/persistence/repository/HrDataScope.java`。

下一次真实联调至少验证：同平台真实员工登录、401/403 独立展示、两个不同员工互不可越权读取、宽权限账号页面文案正确、空数据不替换演示数据、金额与时间对应原业务记录。当前源码审查不替代这些验收。
