# G0 App 与 Platform 最小真实接口合同

核查日期：2026-10-13。依据本地当前源码，只做静态核查；未调用生产接口、未验证部署状态、未注册 OAuth 客户端。本文用于同一 `rigour-sales-workbench` 仓库内三端迁移，不创建第二个正式移动端。

## 1. 接入边界与 G0 最小顺序

App 通过 Gateway 使用现有 IAM 与 Sales API。不得将临时打卡的个人码、Cookie、`temp_sales_checkin_*` ID 直接视为平台 IAM 身份或正式拜访 ID。

最小只读联调顺序：

1. 系统浏览器完成 IAM OIDC Authorization Code + PKCE，获得 Access Token。
2. `GET /api/v1/me` 确认当前租户、员工账号和权限。
3. `GET /api/v1/sales/me/context` 确认销售身份投影、有效销售画像和外勤规则。
4. `GET /api/v1/sales/me/visit-targets?q=&page=1&pageSize=20` 查询本人负责门店。
5. `GET /api/v1/sales/me/visits?date=2026-10-13&page=1&pageSize=20` 查询本人的正式拜访；点击后再请求详情。

这些读取不要求创建新的工作日。G0 不自动签到、不生成演示拜访、不调用高德收费搜索，也不把空数据替换为 Mock 后宣称真实接通。

## 2. 请求和响应约定

- API 基址为部署环境配置的 Gateway HTTPS 地址加 `/api/v1`；旧 `src/api/core/client.ts` 使用 `VITE_API_BASE_URL`，默认相对路径 `/api/v1`。原生 App 应配置明确基址，不能依赖 Vite 代理或 `window.location.origin`。
- 使用 `Authorization: Bearer <access_token>`，不是 ID Token。可带 `Accept-Language: zh-CN`、`X-Request-Id`。旧客户端还发送 `X-Tenant-Id`，但真正身份和租户由 Gateway 验签与 IAM 当前会话校验确定，客户端不得自行拼造 `X-Rigour-*` 身份头。
- Sales 成功响应为 `{ code: "OK", message: "success", data: T, requestId, timestamp }`。错误保留 HTTP 状态、`code/message/requestId`；不将 401/403、身份未绑定或上游错误当成空列表。
- `/api/v1/me` 的源码合同返回裸 `CurrentUserView`，与 Sales 包装格式不同。旧 `iamApi` 对裸对象/包装对象都兼容。
- UUID 用字符串传输。接口 Instant 使用带时区的 ISO 时间；UI 显示为北京时间 `yyyy-MM-dd HH:mm:ss`。API 原始时间与展示格式分离，不能删除时区后当作本地时间计算距离采样新鲜度。
- Sales 分页从 1 开始；门店档案 `pageSize <= 100`，本人拜访列表/附近 POI `pageSize <= 20`。G0 统一请求 20 即可。

## 3. 认证现状与迁移缺口

现有客户端：`src/auth/mobile-oidc.ts`、`src/auth/token-storage.ts`、`src/stores/auth.ts`。

| 阶段 | 当前行为 | 三端迁移要求 |
|---|---|---|
| 配置 | `VITE_AUTH_MODE=oidc`；Issuer、Client ID 必填；例示回调 `com.rigour.workbench://auth/callback`；scope 默认 `openid profile` | 环境配置读取迁移至新运行时；确认 IAM 中真实启用的 PUBLIC 客户端和精确回调白名单，示例地址不等于已注册 |
| Discovery | `GET {issuer}/.well-known/openid-configuration`，读取 authorization/token/userinfo endpoint | 校验目标 Issuer 与可信 HTTPS；不手工猜 token endpoint |
| 授权 | `response_type=code`、`client_id`、`redirect_uri`、`scope`、`state`、`nonce`、`code_challenge_method=S256`、`code_challenge` | Android/iOS/HarmonyOS 各自系统浏览器和回调、冷启动回调均验收；无 client secret |
| 交换 | 对 discovery 的 token endpoint 表单 POST：`grant_type=authorization_code`、`client_id`、`redirect_uri`、`code`、`code_verifier` | 网络错误不得输出 code/verifier/token；单次消费，明确回调超时 |
| 安全状态 | 当前 PKCE pending 写 sessionStorage/localStorage；验证 state 和 10 分钟有效期 | 新 App 使用原生安全状态存储；校验精确 callback scheme/host/path，补全标准 OIDC ID Token 签名/iss/aud/nonce 校验或使用成熟原生协议实现 |
| Token | 原生 Capacitor 使用安全存储插件；Web/旧路径回落 localStorage | 三端安全存储分别落实；不得把生产 Token 放入普通 storage/日志/诊断导出 |
| 会话 | 当前接口客户端没有 token refresh；旧 OIDC 响应类型也不接收 refresh_token；401 提示重新登录 | G0 可明确要求会话失效重新登录；长期版需实现安全 refresh 轮换和登出撤销。IAM 服务源码支持 PUBLIC refresh，不等于 App 已完成 |
| 权限 | 登录后调用 `/me` 读取 roles/permissions，客户端本地 catalog 推导入口 | 按平台当前权限展示功能且以服务端校验为准；现有本地 catalog 不是完整远程 App 配置合同 |

当前旧 OIDC 代码生成了 nonce，但未核验返回 ID Token 中的 nonce，且 JWT payload 解码不是验签；不要把它照搬为新三端安全实现。Issuer、Client ID、真实回调注册和 DEV 登录账号在本轮均未验证。

## 4. 可直接复用的只读接口

### 4.1 当前用户与销售上下文

`GET /api/v1/me` 返回：

```text
id, tenantId, tenantName, principalScope, username, displayName,
roles: string[], permissions: string[]
```

`GET /api/v1/sales/me/context`，权限 `sales:context:read`，返回 `SalesContextView`：

```text
userId, employeeId, salesProfileId, salesNo,
cityOrgId: UUID|null, profileStatus, permissions: string[],
fieldPolicy: {
  id, policyCode, policyName, versionNo, publishStatus,
  timezoneId, businessDayCutoff,
  checkInWindowStart, checkInWindowEnd, checkOutWindowStart, checkOutWindowEnd,
  standardWorkMinutes, minimumWorkMinutes, requireCheckOut,
  allowAdjustment, adjustmentDeadlineHours, locationEnabled,
  locationIntervalMinutes, minimumLocationAccuracyMeters,
  offlineUploadDeadlineMinutes, effectiveFrom
}
```

后端要求 `principalScope=TENANT`、有效租户与用户；IAM 用户必须有 Sales 身份投影和有效销售画像、生效外勤规则。未就绪分别可能返回 `SALES_IDENTITY_UNBOUND`、`SALES_PROFILE_INACTIVE`、`SALES_POLICY_NOT_FOUND`。G0 应显示明确初始化缺口，不能在 App 里临时选择他人身份绕过。

该响应**没有**城市名称、可切换业务城市列表、完整拜访规则（200 米/照片/录音）、App 最低版本/发布通道等。不能假装这些已经由 context 下发。

### 4.2 内部门店档案

`GET /api/v1/sales/me/visit-targets?q={keyword}&page=1&pageSize=20`，权限 `sales:visit-target:read`。

返回 `data = { items: VisitTargetView[], page, pageSize, total }`，每个 item：

```text
projectionId, targetType, customerId, storeId, customerName,
storeName, storeAddress, longitude, latitude, storeStatus,
sourceVersion, sourceUpdatedAt
```

查询本人有效负责门店投影，关键字匹配门店名、客户名和地址，当前数据库按 `store_name, store_id` 排序；没有距离字段/城市参数/坐标系标识，不是全量 CRM 档案检索。输入触发此接口不调用高德。地图和附近功能在 G0 未准备好时不得把它伪装成“距离最近”。

`GET /api/v1/sales/me/nearby-stores?longitude&latitude&radiusMeters&q&page&pageSize` 另需 `sales:poi:read`，当前服务实际调用 **AmapPoiClient**，默认半径 3000 米，允许 100–5000 米；返回 `poiId/name/address/type/typeCode/longitude/latitude/distanceMeters/storeId/alreadyInMyStores/source=AMAP`。它不是天地图接口，G0 不自动请求，后续替换提供商须同步坐标和目标来源合同。

### 4.3 本人拜访记录和详情

`GET /api/v1/sales/me/visits?date=YYYY-MM-DD&page=1&pageSize=20`，权限 `sales:visit:own:read`。`date` 可省略表示全部日期；当前列表**不支持** `from/to` 日期区间或多字段排序参数。

返回 `data = { items: VisitView[], page, pageSize, total }`：

```text
VisitView:
  id, workDayId, salesProfileId, targetType, customerId, storeId,
  status, checkedInAt, checkedOutAt, visitPolicyVersionId,
  targetSnapshot, checkpoints[], createdAt,
  contactOutcome, kpName, kpPhone, intentionLevel, resultNote,
  resultSubmittedAt, visitType, reviewStatus

targetSnapshot:
  targetType, customerId, storeId, customerName, storeName, storeAddress,
  longitude, latitude, assignedSalesProfileId

checkpoint:
  id, checkpointType, deviceEventId, clientOccurredAt, serverReceivedAt,
  longitude, latitude, accuracyMeters, distanceToTargetMeters, evidenceStatus
```

列表为了批量查询，当前实现将 `checkpoints` 置为空数组；点击后请求 `GET /api/v1/sales/me/visits/{visitId}`，详情才含 checkpoint 位置与距离。范围由服务端当前租户 + 本人销售画像限定，不能传任意 salesProfileId 查询别人。

`status` 与 `reviewStatus` 是两个维度：到店/离店状态不能替代有效性复核。旧客户端定义常见值 `CHECKED_IN/CHECKED_OUT`、`IN_PROGRESS/PENDING_REVIEW/EFFECTIVE/INEFFECTIVE`，未知状态应有保守展示。

`GET /api/v1/sales/me/activity-summary?from=YYYY-MM-DD&to=YYYY-MM-DD` 同为 `sales:visit:own:read`，返回总拜访/完成/进行中/有效/待复核/初访/复访/去重门店/负责门店计数；该汇总支持日期区间但不代表记录列表也支持区间。

`GET /api/v1/sales/me/visits/{id}/recordings` 与 `/evidence` 已有录音/照片元数据合同，分别要求本人录音/证据读取权限。普通 VisitView 不含照片缩略图 URL 和录音明细；不得因列表拿到一个 visit 就宣称媒体播放已经接通。

## 5. 创建拜访的工作日前置：不可静默代办

`GET /api/v1/sales/me/work-days/{date}`（`sales:context:read`）读取本人工作日，不存在返回 `SALES_WORK_DAY_NOT_FOUND`，不会自动创建。

`POST /api/v1/sales/work-days/check-in`（`sales:work-day:write`）才创建/重新开启工作日。请求：

```text
{ idempotencyKey, clientInstanceId, clientOccurredAt,
  location: { longitude, latitude, accuracyMeters, source },
  deviceIdHash, networkType }
```

此动作创建真实签到事实并执行外勤规则/签到时间窗，以服务端时间计算业务日。不是无副作用的准备步骤。成功返回 `WorkDayView`：`id/employeeId/salesProfileId/businessDate/timezoneId/fieldPolicyVersionId/status/checkedInAt/checkedOutAt/locationSessionId/locationPointCount/interruptionCount/verifiedWorkMinutes/evidenceQuality`。

`POST /api/v1/sales/me/visits`（`sales:visit:own:write`）请求：

```text
{ idempotencyKey, workDayId, visitPlanId?, targetType: "MY_STORE"|"POI",
  storeId?, poi?: { poiId, name, address, longitude, latitude, distanceMeters },
  location: { longitude, latitude, accuracyMeters, source },
  clientOccurredAt, deviceEventId }
```

后端校验工作日属于本人且 `ACTIVE`、存在生效拜访规则、目标在规则允许范围内、到店坐标与门店距离不超规则半径、没有另一场进行中拜访；不是客户端传入 200 就按 200 校验。

当前 `LocationEvidence` 没有坐标系、独立采样时间、地址快照和定位诊断字段。距离在服务端计算，但单靠现有合同不能证明位置新鲜或一致坐标系。G0 的原生定位验证可独立进行；正式写入前应扩展合同，不能直接混用 GPS WGS84 与旧高德 GCJ02。

若产品希望“无需上下班签到即可门店打卡”，必须明确修改正式业务前置；本轮 G0 不伪造 ACTIVE 工作日，也不通过客户端绕过该校验。

## 6. 尚未实现/未验收清单

- 新三端 OIDC 系统浏览器、回调冷启动、安全存储、ID Token 校验、refresh 和撤销尚需实现/真机验收。
- 当前有效 OAuth Client ID、回调注册、HTTPS Gateway、平台真实员工账号及其 Sales 投影与规则，需要指定 DEV 环境验证；源码有能力不等于环境可用。
- App 生效拜访规则、城市名称/选择、功能配置/最低版本尚无完整启动合同；已有权限数组不可替代全部配置。
- Tianditu 搜索/逆地理/地图授权和统一坐标事实尚未接入正式 Sales 合同。
- 原生分段落盘、进程重启任务恢复、断点续传/对象存储授权、服务端完整性确认未由当前 multipart API 自动解决。
- 旧录音上传业务限制（短录音不保存、分片时长校验）不能直接用于新可靠传输分片；业务录音与传输分片要区分。
- 正式本人列表日期区间、媒体缩略图/播放与完整地址展示、临时历史记录整合需后续补齐。G0 不声称已完成这些业务。

## 7. 源码索引

本仓库：

- `src/auth/mobile-oidc.ts`：discovery、code + PKCE、系统浏览器和回调；`src/auth/token-storage.ts`：现有原生安全存储与旧 Web 回落。
- `src/stores/auth.ts`：OIDC/飞书/Mock 分流，登录后加载 `/me`；`src/api/core/iam.ts`：CurrentUserView。
- `src/api/core/client.ts`：基址、headers、timeout、响应处理；`src/api/core/sales.ts`：已有 TS API 和字段。
- `src/features/catalog.ts`：当前客户端权限到入口的本地映射，不是完整远程功能配置。

Platform 仓库根为工作区 `06_代码工程/rigour-supply-chain-digital-platform`，以下为该仓相对路径：

- `services/rg-scdp-sales/sales-api/src/main/java/com/rigour/sales/api/v1/SalesWorkApi.java`：正式全部路径与请求参数。
- `services/rg-scdp-sales/sales-api/src/main/java/com/rigour/sales/api/v1/model/SalesWorkApiModels.java`：权威请求/响应模型。
- `services/rg-scdp-sales/sales-server/src/main/java/com/rigour/sales/application/service/SalesWorkContextService.java`：身份、规则、负责门店前置。
- `services/rg-scdp-sales/sales-server/src/main/java/com/rigour/sales/infrastructure/persistence/JdbcSalesWorkQueryRepository.java`：内部档案匹配及排序。
- `services/rg-scdp-sales/sales-server/src/main/java/com/rigour/sales/application/service/SalesWorkVisitService.java`：列表/详情区别、工作日前置、距离/单场拜访校验。
- `services/rg-scdp-sales/sales-server/src/main/java/com/rigour/sales/application/service/SalesWorkAttendanceService.java`：签到、副作用和工作日读取。
- `services/rg-scdp-iam/iam-api/src/main/java/com/rigour/tenant/iam/api/v1/IamIdentityApi.java` 与 `model/CurrentUserView.java`：`/me`。
- `services/rg-scdp-iam/iam-server/src/main/java/com/rigour/tenant/iam/infrastructure/config/IamAuthorizationServerSecurityConfiguration.java`：OIDC 服务、PUBLIC refresh。
- `services/rg-scdp-gateway/gateway-server/src/main/java/com/rigour/gateway/security/TrustedContextFilter.java`、`CurrentTokenValidationFilter.java`：JWT、当前会话/权限、可信下游身份。
- `shared/shared-core/src/main/java/com/rigour/shared/core/api/ApiResponse.java`：Sales 响应包装。

验证范围：已核对源码合同、控制器和服务实现；未运行服务、未调用真实账户、未写拜访、未触发付费地图 API。
