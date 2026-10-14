# 销售工作台 App V1 接口就绪审查

更新：2026-10-14。本轮已核对 Platform 合同、接通隔离 DEV 服务并执行 DEV 数据库只读计数；Android 真机已完成管理员登录、`/me` 读取，以及客户列表、客户详情和订单列表可读验证，未完成真实销售账号的数据范围验收。未调用或修改生产临时打卡。原 G0 Sales 详细合同见 `app-g0-platform-contract.md`；当前环境证据见 [DEV 联调回执](app-v1-dev-integration-receipt-20261014.md)。

## 1. 当前可实施边界

- App 复用平台 Gateway、IAM 和各领域服务；不创建独立账号库，不复制业务状态机。服务器仍决定功能权限和数据范围。
- 本轮可实现正式原生页面、真实只读接口客户端、明确的未登录/无权限/无数据/失败状态，以及本机草稿。未具备完整合同的写动作不能显示“提交成功”。
- Sales 的 `/me/*` 查询确实由服务端限制为本人。CRM、Order、BI 的普通查询按平台授权范围读取，可能是本人、部门、地区或全部；页面不能一律叫“我的”，不能靠请求中附带 `ownerEmployeeCode` 代替服务端授权。
- 商品管理 `erp:product:read` 同时能读含进价的详情。App 只调用不含规格的列表能避免页面主动拉取进价，但不是服务端字段授权。面向普通销售开放前仍需销售商品专用 DTO/权限，不应仅靠前端隐藏解决。
- 客户、订单查询与商品安全投影已接入正式 API 路径；商品详情按 `productIds` 重新读取 `withVariants=false` 的列表投影。客户订单入口目前是名称搜索，已明确可能包含同名客户，不声称按客户 ID 精确关联。
- 搜索条件变化时重新从第 1 页取数；详情缓存不再混入分页列表。权限失效/请求失败不保留旧列表，账号隔离的本机购物草稿仍保留；未开放的报价、订单提交、回款、退货不会伪装成成功。

## 2. 身份与网络

### 已有能力

- IAM 支持 PUBLIC Client 的 Authorization Code + PKCE、Refresh Token 轮换。
- `GET /api/v1/me` 返回裸 `CurrentUserView`：`id, tenantId, tenantName, principalScope, username, displayName, roles[], permissions[]`。Sales/CRM/ERP/Order/BI 通常为 `ApiResponse`：`{code:"OK",message,data,requestId,timestamp}`。
- 业务 API 用 `Authorization: Bearer <access_token>`，不使用 ID Token，不伪造 `X-Rigour-*` 身份头。租户由可信认证上下文确定。
- `/login` 是 Spring Security HTML 表单和 CSRF 登录；`/scdp/session` 只返回浏览器会话及 CSRF 状态。没有查到可直接供 App 提交用户名密码换 Token 的 JSON API。

### 本轮 DEV 已完成

- App `config.uts` 采用 `development`、Gateway `http://localhost:27680`、IAM `http://localhost:27681`、PUBLIC Client ID `rigour-sales-app-android-dev`、调试回调 `uniappx://rigour-sales/auth/callback`。Android 需通过 ADB reverse 连接本机服务。
- Platform 隔离工作树 B2 的 `SalesAppClientBootstrapCommand` 已随 IAM 启动成功注册上述客户端；这是 DEV 客户端注册证据，不是正式环境或公司签名包注册证据。
- Gateway 27680、IAM 27681、Sales 27686 health 为 UP。Sales 临时 check-in worker、AI worker 禁用；无新增迁移，生产临时打卡保持原状。
- 9 个主 DEV 服务在 Nacos 的实例地址均为当前 `.106` 主机，且 healthy；隔离 App 三服务的 health 检查同时为 UP。
- Android 已实现系统浏览器 OAuth Code + S256 PKCE，申请 `profile`，不使用 ID Token；通过 `/me` 读取真实公司身份与权限。HTTP 和调试 scheme 仅允许精确的 DEV 组合，非开发环境禁止使用该调试 Client ID。实际配置行为已纳入自动测试。
- `App.uvue` 组合式钩子改为 `onAppShow`，保留完整的 `appScheme` / `appLink` 参数和严格 state/PKCE 校验。新版已同步到手机；14:34:46 用户手动打开 App，14:34:55 `/oauth2/token` 返回 200，14:34:57 `/api/v1/me` 返回 200，用户确认显示“管理员”。14:35:06、14:35:12 客户列表接口返回 200；14:36:56 客户详情 `/api/v1/crm/internal-customers/4233` 返回 200；14:37:24 订单列表 `/api/v1/orders/sales` 返回 200。用户确认“能看到详情，订单”，管理员客户列表、客户详情及订单列表可读已验证，不扩展为订单详情或逐字段核对完成。
- `api.uts` 按文本接收响应，经 `parseApiJson` 保留大整数 ID；公开 Sales 403/409/404 业务错误映射为固定中文，不展示后台原文。

### 仍待验收

- 本轮检查的 2 个 DEV IAM 账号均未匹配 Sales identity，未进行冒用身份绑定。管理员的 Sales `activity-summary` 返回 403 符合未绑定销售身份的状态；需要具备本人销售档案、平台权限及生效规则的真实账号验证，数据库有记录不代表该账号可见。
- Android 管理员的浏览器登录返回、`/me` 身份读取、客户列表/详情和订单列表可读已通过；订单详情、拜访列表/详情、字段逐项核对和真实销售员工可见范围仍待验收。iOS、HarmonyOS、Web 公司登录尚未接入，编译成功不等于登录可用。
- 正式环境还需 HTTPS origin、正式 PUBLIC Client 注册及公司签名包的精确回调。当前 `com.rigour.workbench://auth/callback` 仍为正式合同，不能用 DEV 注册代替正式确认。
- 三端必须验证冷启动回调、加密随机 state/verifier、S256、state 单次消费与超时、安全令牌存储。当前 Token 仅保存在内存，不保存密码、Token 至普通 storage、日志或诊断导出。若后续申请 `openid` 并使用 ID Token，必须完整校验签名、iss、aud、nonce。

## 3. 可复用的只读接口

以下地址均相对 Gateway；除 `/me` 外先解包 `data`。CRM/ERP/Order 分页统一 `{total, begin, step, items}`，`begin` 是 0/20/40 的记录偏移。Sales 分页是 `{total,page,pageSize,items}`，`page` 从 1 开始。

| 页面 | 路径、参数 | 权限与字段 |
|---|---|---|
| 客户列表 | `GET /api/v1/crm/internal-customers?begin=0&step=20&customerName=` | `crm:customer:read`；`id(Long),customerName,contactName,contactPhone,cityName,regionName,statusCode,customerTypeCode,ownerEmployeeCode` |
| 客户详情 | `GET /api/v1/crm/internal-customers/{id}` | 同上，额外 `address,remark` 等；不是 UUID 版 `/crm/customers` |
| 收货地址 | `GET /api/v1/crm/internal-customers/{id}/shipping-addresses` | `crm:customer:read`；data 数组：`id(UUID),consignee,contact,phone,regionText,addressDetail,fullAddress,defaultAddress,revision` |
| 商品列表 | `GET /api/v1/erp/product-management/products?begin=0&step=20&productName=&withVariants=false` | `erp:product:read`；`id,productName,productCode,productSpecification,unitCode,mainImageUrl,defaultSalePrice,shelfStatusCode,submitStatusCode,variantCount`；默认价只能标参考价，未返回库存 |
| App 商品详情 | `GET /api/v1/erp/product-management/products?begin=0&step=1&productIds={id}&withVariants=false` | 精确 ID 安全投影，核对返回 ID；不调用含采购价的管理详情 |
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

2026-10-14 源码复核：IAM 员工绑定使用 `employeeCode`，HR 身份接口返回 Long `id`；正式 Sales 的 `employeeId` 仍是 UUID/BINARY(16)。未找到 IAM/HR 到 `sales_identity_projection`、`sales_profile` 的自动事件消费者或同步任务，当前仅有管理员维护入口。因此新建普通员工账号不能自动解决 Sales 身份契约，也不能把 IAM userId 或随机 UUID 当作 HR employeeId。读取依次要求功能权限、有效身份投影、有效销售档案；缺身份返回 403 `SALES_IDENTITY_UNBOUND`，缺档案返回 403 `SALES_PROFILE_INACTIVE`，`/me/context` 缺生效外勤规则返回 409 `SALES_POLICY_NOT_FOUND`。

- Sales 门店合同的 customerId/storeId 是 UUID；CRM 内部客户、ERP 商品、Order 订单使用 Long。当前没有查到可供 App 直接使用的统一客户门店映射合同。选中的 CRM Long customerId 不能传给 Sales 创建拜访。
- Long 的传输与精度：上述三个内部实体使用 `@TableId(type = IdType.AUTO)`；当前列表/详情 DTO 的 Long 字段无字符串序列化注解，也未查到全局 Long 转字符串的 Jackson 定制，按源码默认输出 JSON number，并非 Snowflake ID 模型。App 现已用 `uni.request<string>`、`dataType:'text'` 和 `parseApiJson`，在普通 JSON 解析前将超出 `±9007199254740991` 的整数字面量保留为字符串；已有字符串、小数和指数保持原语义。畸形 JSON 和非对象根返回失败。商务 ID 优先接收精确字符串；若仍收到不安全 number 则阻断关联，不能先失精再转 string。没有为此修改平台历史 DTO 或数据库。真实销售账号报文仍需验收。
- 客户：`ACTIVE=启用`、`INACTIVE=停用`。
- 订单：`DRAFT=草稿`、`SUBMITTED=已提交`、`COMPLETED=已完成`、`CANCELLED=已取消`。不能把 SUBMITTED 强行显示为原型的“待审核”，当前状态机没有独立审批状态。
- 收款：`UNPAID=未收款`、`PARTIAL_PAID=部分收款`、`PAID=已收款`、`CANCELLED=已取消`。
- 出库：`PENDING=待出库`、`PARTIAL_OUT=部分出库`、`OUT_CONFIRMED=已出库`。出库不等于签收。
- 拜访到店/离店状态和 `reviewStatus` 分开；已到店不等于有效拜访。录音片段数不等于“有录音的拜访数”。

## 5. 写能力缺口与下一步

正式身份接入可复用 IAM `GET /internal/v1/iam/supply/authorization?action=sales:context:read`：由服务端携带受信原操作人身份，核验会话、账号与 HR 资格后读取 `employeeCode`、权限及版本，App 不直接调用内部端点。Sales 应按真实 HR 员工编码/Long ID 引用员工，并通过核验、审计的正式命令开通或停用自身档案，不能靠管理员账号或临时映射绕过。CRM 的 `crm_store_projection`、`crm_sales_assignment_projection` 同样尚无自动同步链；还需接通真实客户/门店标识与归属的版本化投影，不能把身份接通等同于已能读取真实拜访目标。

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

- IAM：`services/rg-scdp-iam/iam-server/src/main/java/com/rigour/tenant/iam/infrastructure/bootstrap/{ScdpClientBootstrap,SalesAppClientBootstrap}{Properties,Command}.java`；`api/controller/auth/{AuthController,ScdpSessionController}.java`；`infrastructure/security/oidc/JdbcRegisteredClientRepository.java`。
- CRM：`services/rg-scdp-crm/crm-api/src/main/java/com/rigour/merchant/api/v1/CrmInternalCustomerApi.java`；`crm-server/.../infrastructure/persistence/repository/CrmDataScope.java`。
- ERP：`services/rg-scdp-erp/erp-api/src/main/java/com/rigour/erp/api/v1/ErpProductManagementApi.java` 与 `model/ProductVariantManagementView.java`；`erp-server/.../application/service/product/ErpProductManagementService.java`。
- Order：`services/rg-scdp-order/order-api/src/main/java/com/rigour/order/api/v1/{OrderSalesOrderApi,OrderSalesPaymentRecordApi}.java`；`order-server/.../application/service/sales/OrderSalesOrderService.java`；`infrastructure/persistence/repository/{OrderDataScope,MybatisPlusSalesPaymentRecordRepository}.java`。
- Sales：`services/rg-scdp-sales/sales-api/src/main/java/com/rigour/sales/api/v1/{SalesWorkApi.java,model/SalesWorkApiModels.java}`；`sales-server/.../application/service/SalesWorkRecordingService.java`。
- BI：`services/rg-scdp-bi/bi-server/src/main/java/com/rigour/analytics/application/service/BiDataScopeService.java`；`infrastructure/persistence/scope/{BiScopePredicates,BiAuthorityFilter}.java`。
- HR：`services/rg-scdp-hr/hr-api/src/main/java/com/rigour/hr/api/v1/HrPayrollApi.java`；`hr-server/.../infrastructure/persistence/repository/HrDataScope.java`。

本轮 `npm run app:v1:test` 为 86/86；`onAppShow` 修复后 Android 14:33:11、iOS 14:37:26 原生编译和 HarmonyOS 14:44:08 unsigned HAP 构建通过，iOS/HarmonyOS 公司登录仍未接入。iOS、鸿蒙日志分别为 `/tmp/sales-app-ios-auth-callback-build.log`、`/tmp/sales-app-harmony-auth-callback-build.log`。Android 手机已同步，管理员登录和客户列表/详情、订单列表可读已验证；订单详情、逐字段核对及真实销售账号范围仍待验收。DEV 数据库只读快照为 CRM 客户 2,508、订单 4,027、正式拜访 11；这些是环境记录数，不是任何销售账号的授权可见数量。

下一次真实联调至少验证：同平台真实员工登录、401/403 独立展示、两个不同员工互不可越权读取、宽权限账号页面文案正确、空数据不替换演示数据、列表与详情的精确 ID、金额和北京时间对应平台原记录，以及第二页/切换筛选不混数据。当前服务 health、计数、mock 测试和编译不替代上述账号验收。
