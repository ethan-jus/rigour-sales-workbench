# 销售工作台 App DEV 联调回执

日期：2026-10-14。本文较早的手机登录证据来自浏览器方案；用户随后确认改用 App 原生账号密码表单，新的实现与待验收项见下一节。真实销售账号范围尚未验收。本文不包含凭据或 Token。


## 原生账号密码登录更新

- 用户确认：App 自有账号密码表单，密码校验、权限、会话和 Token 刷新仍由 IAM 统一负责。
- App 已替代浏览器跳转/回调路径，加入 Android Keystore refresh 保存、启动恢复、单飞轮换和401一次重试；本机业务草稿不因 Access Token 到期被清理。
- `npm run app:v1:test`：125/125通过，日志 `/tmp/sales-app-native-auth-final-tests.log`；含退出清除整体失败、断网、进程重开、正常退出重开及再次显式登录的行为回归。
- 退出修复后的最终原生编译：Android 15:30:44（`/tmp/sales-app-native-login-android-build-final2.log`）、iOS 15:32:01（`/tmp/sales-app-native-login-ios-build-final.log`）、HarmonyOS unsigned HAP 15:32:48（`/tmp/sales-app-native-login-harmony-build-final.log`）。iOS/HarmonyOS认证适配仍未完成；编译不等于真机登录支持。
- 退出补丁经独立源码行为复核通过：pending落地后重开不读旧凭据；清除失败+断网不报成功；重试可完成；done重开无错误；新显式登录仅在安全保存成功后移除退出标记。
- IAM 35项检查通过，含21项真实Spring Security/Testcontainers流程，日志 `/tmp/iam-native-login-integration-v3.log`；覆盖原生密码认证、锁定、PKCE、refresh轮换/重放、账号停用、当前会话退出和Web刷新回归。
- IAM 已成功打包；后端原生登录提交为 `6a78499`。
- V133已在隔离测试数据库成功执行。共享DEV只读 `Flyway.validateWithResult()` 确认 V132 为 `APPLIED_VERSIONED_MIGRATION_NOT_RESOLVED`，V133 尚未执行，日志 `/tmp/iam-native-dev-flyway-validate.log`。本机与远程dev缺V132原始SQL；在找回原始文件前不迁移、不关闭校验、不repair。原生登录尚未替换正在运行的隔离IAM，不能据测试报告声称手机已可用。
- 数据库规范脚本未能执行：该工作树缺其依赖的 `scripts/database/general-ci-baselines.json`。V133只扩展CHECK，未改字符列或历史迁移。
- 待补齐迁移后，启用IAM原生入口、同步手机，验证平台同账号原生登录、短期Token续期、重开App恢复与退出。之前浏览器登录成功不替代这些检查。

## 较早浏览器方案已确认

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

- DEV Sales 的临时 check-in worker 与 AI worker 已禁用；共享 DEV 尚未执行本次新增的 V133 数据库迁移。
- 生产临时打卡服务保持原状，本轮未切流、迁移、停用或修改其业务数据。
- 正式上线还需正式 HTTPS 配置、PUBLIC Client 和公司签名回调，以及真实账号/设备验收；DEV health 和编译回执不能替代上线条件。

较早浏览器方案已确认 Android 管理员登录，以及客户列表、客户详情和订单列表可读；原生表单的真实 DEV 验收仍待完成，不能扩展为“订单详情已验收”“销售登录成功”或“真实销售数据已全部通过”。
