# 销售工作台 App DEV 联调回执

日期：2026-10-14。范围：原生 App 与隔离 DEV 接入、Android 管理员真机登录验证；真实销售账号验收尚未完成。本文不包含个人标识、凭据或 Token。

## 已确认

- App DEV：Gateway `http://localhost:27680`、IAM `http://localhost:27681`，Android PUBLIC Client `rigour-sales-app-android-dev`，回调 `uniappx://rigour-sales/auth/callback`。HTTP 仅允许指定 loopback，调试 scheme 受精确环境/客户端/端口约束，非开发环境禁止该调试客户端。
- Platform 隔离工作树 B2 的调试客户端注册已随 IAM 启动成功；Gateway 27680、IAM 27681、Sales 27686 health 均为 UP。
- 9 个主 DEV 服务在 Nacos 的实例地址均为当前 `.106` 主机，且 healthy；隔离 App 的三个服务 health 也为 UP。
- DEV 数据库只读计数：CRM 客户 **2,508**、订单 **4,027**、正式拜访 **11**。这些计数证明环境存在业务记录，不证明某销售账号可见或手机页面已展示。
- `npm run app:v1:test`：**86/86 通过**，含登录状态、API/配置边界、JSON 大整数、商务与拜访回归。
- **`onAppShow` 修复后的 Android、iOS、HarmonyOS 三平台编译通过**：Android **14:33:11**，iOS **14:37:26**（`/tmp/sales-app-ios-auth-callback-build.log`），HarmonyOS unsigned HAP **14:44:08**（`/tmp/sales-app-harmony-auth-callback-build.log`）。鸿蒙未配置签名证书，不代表已签名发布或真机安装；此前 14:17:27 的鸿蒙构建已由本次修复后构建复验。
- API 使用文本响应和无损整数解析，避免客户/订单 ID 先转为不精确数字；错误响应不会显示后台堆栈。购物草稿按账号、租户、客户隔离，未开放写能力不会显示假成功。

## Android 真机登录与只读请求

- 初次登录浏览器已唤起 App，但未发起授权交换。核对本机官方类型、示例与标准基座实现发现：组合式普通 `onShow` 不透传启动参数，`onAppShow` 才接收 `OnShowOptions`。已仅将 App 钩子改为 `onAppShow`，保留严格回调地址、state 和 PKCE 校验；没有增加绕过校验或轮询回调。
- 修复后的 Android 代码于 **14:33:11 编译成功**。早先同步时基座无响应，以及手机锁屏时调试服务受后台启动限制，均属历史尝试；用户手动打开 App 后，**14:34:46 新版已在手机启动，已确认同步成功**。
- **14:34:55**：IAM `POST /oauth2/token` 返回 **200**；**14:34:57**：App Gateway `GET /api/v1/me` 返回 **200**。用户确认 App 显示“管理员”，管理员账号的实际登录回调与身份读取已通过。
- **14:35:06、14:35:12**：`GET /api/v1/crm/internal-customers` 返回 **200**；**14:36:56**：`GET /api/v1/crm/internal-customers/4233` 返回 **200**；**14:37:24**：`GET /api/v1/orders/sales` 返回 **200**。用户确认“能看到详情，订单”，管理员客户列表、客户详情及订单列表可读已验证；尚未验证订单详情或逐字段核对。
- Sales `activity-summary` 返回 **403**，符合当前管理员没有 Sales 身份绑定的状态。未为绕过该结果冒用销售身份，不计为销售数据验收完成。

## 未完成的验收

- 本轮检查的 **2 个 DEV IAM 账号均未匹配 Sales identity**，没有冒用销售或改写身份绑定。
- 管理员登录不能替代真实销售账号验收。需要具备本人销售档案、权限与生效规则的员工账号登录，再对比平台与 App 的客户、订单、拜访列表/详情，以及不同员工之间的数据范围。
- 订单详情、拜访列表/详情，以及页面字段、金额、时间与精确 ID 的逐项核对仍待验收。管理员客户列表/详情及订单列表可读的确认不替代这些检查，也不证明普通销售的数据隔离。
- iOS、HarmonyOS、Web 的公司登录尚未接入；三平台编译通过不代表 iOS/HarmonyOS 登录或录音等真机能力验收完成。
- 报价、正式开单、回款提报、退货及完整拜访提交链路继续按 [接口就绪审查](app-v1-api-readiness.md) 的缺口分阶段补齐。

## 环境保护

- DEV Sales 的临时 check-in worker 与 AI worker 已禁用；本轮无新增数据库迁移。
- 生产临时打卡服务保持原状，本轮未切流、迁移、停用或修改其业务数据。
- 正式上线还需正式 HTTPS 配置、PUBLIC Client 和公司签名回调，以及真实账号/设备验收；DEV health 和编译回执不能替代上线条件。

本轮已确认的是 Android 管理员登录，以及客户列表、客户详情和订单列表可读，不能扩展为“订单详情已验收”“销售登录成功”或“真实销售数据已全部通过”。
