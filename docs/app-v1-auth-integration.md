# App V1 公司登录接入

更新：2026-10-14。实现：`app/services/auth.uts`。Android 已完成隔离 DEV 管理员账号的真机浏览器登录回调、授权交换和 `/me` 身份读取；真实销售账号及业务数据范围仍待验收。本文不代表生产接入完成。

## 当前行为

- Android：使用 `java.security.SecureRandom` 生成独立 32 字节 verifier 和 state；原生 SHA-256 计算 S256 challenge；Base64URL 无填充编码；通过 `ACTION_VIEW` 打开系统浏览器。
- OAuth 请求只申请 `profile`，不申请 `openid`，不使用或解码 ID Token；交换得到 Access Token 后，通过配置的可信 Gateway `GET /api/v1/me` 验证公司租户员工身份，并读取平台权限。正式环境要求 HTTPS；本轮 DEV 的精确 loopback 例外见下表。
- discovery 的 issuer 必须匹配配置，authorization/token endpoints 必须与配置 issuer 同 origin；Gateway 必须是无路径的 origin。不接受凭据内嵌 URL、隐式授权 Token 回调、重复查询参数、非精确回调、state 不匹配或过期回调。
- state/verifier 和 Access Token 仅在进程内存中。登录等待 5 分钟自动终止，同一授权回调只交换一次，退出会取消在途登录结果。错误提示不包含 code/verifier/token、完整回调或服务端错误原文。
- session 失效要求重新登录。本轮不保存、不使用 Refresh Token；若服务端返回 refresh_token 也不落盘。
- `logoutCompany()` 清除本 App 会话，不声称已经撤销其他客户端或系统浏览器的公司登录。后续全局退出/撤销应增加对应 IAM 合同及验收。
- iOS、HarmonyOS、Web 暂返回“此系统的公司登录仍在接入中”，不回落演示身份或不安全随机数。页面可跨端编译不代表三端认证已经就绪。

## 接入调用

```uts
import { beginCompanyLogin, handleAuthCallback, logoutCompany } from './services/auth.uts'

// 登录按钮由页面显示失败文案；success 后跳转工作台。
beginCompanyLogin(() => { /* 导航工作台 */ }, (message) => { /* 展示错误 */ })

// App.uvue 组合式的 onLaunch / onAppShow 检查 appScheme / appLink：
// 若非空，原样交给 handleAuthCallback；不要写日志。
handleAuthCallback(callbackUrl)

// 用户显式退出当前 App。
logoutCompany()
```

组合式 App 生命周期使用 `onAppShow` 接收 `OnShowOptions`；Android 标准基座的普通 `onShow` 钩子不会透传这些参数。不要替换为页面级钩子，也不要打印完整授权回调。

首次普通启动没有授权状态，不会自动登录。浏览器返回后，如果 App 进程仍存在，内存里的 verifier 可用于安全交换；若系统杀死进程，回调会要求重新发起登录。这是未引入安全状态存储的明确限制，不能把它说成支持进程被杀后的登录恢复。

## 本轮 DEV 配置与验证

| 项目 | 当前值 / 状态 |
|---|---|
| 环境 | `development`，仅用于本机隔离 DEV 联调 |
| Gateway | `http://localhost:27680` |
| IAM issuer | `http://localhost:27681` |
| PUBLIC Client ID | `rigour-sales-app-android-dev` |
| Android 调试回调 | `uniappx://rigour-sales/auth/callback` |
| 客户端注册 | Platform 隔离工作树的 `SalesAppClientBootstrapCommand` 已随 IAM 启动完成注册 |
| 连接要求 | Android 通过 ADB reverse 访问上述本机端口；不能将手机的 localhost 当作电脑 LAN 地址 |
| 服务检查 | Gateway 27680、IAM 27681、Sales 27686 health 均为 UP |
| 主 DEV 服务发现 | 9 个主 DEV 服务在 Nacos 的实例地址均为当前 `.106` 主机，且 healthy |

HTTP 仅允许 `development` 中精确的 `localhost:27680`、`localhost:27681`，拒绝相似前缀、userinfo、其他端口、IP 别名和 LAN 地址。调试回调还要求精确的环境、Client ID、Gateway/issuer 组合；非开发环境拒绝该调试 Client ID。正式 HTTPS 的同 origin 校验继续保留。

Android 新版已同步到手机。修复 `onShow` 未透传参数的问题后，用户于 14:34:46 手动打开 App；14:34:55 IAM `POST /oauth2/token` 返回 200，14:34:57 App Gateway `GET /api/v1/me` 返回 200，用户确认 App 显示“管理员”。14:35:06、14:35:12 客户列表 `GET /api/v1/crm/internal-customers` 均返回 200；14:36:56 客户详情 `GET /api/v1/crm/internal-customers/4233` 返回 200；14:37:24 订单列表 `GET /api/v1/orders/sales` 返回 200。用户随后确认“能看到详情，订单”，管理员客户列表、客户详情及订单列表可读已验证；不包含订单详情、逐字段核对或普通销售数据范围验收。

本轮检查的 2 个 DEV IAM 账号均未匹配 Sales identity；没有冒用员工或补写销售绑定。管理员调用 Sales `activity-summary` 返回 403，符合该账号未绑定销售身份的状态，不能算作销售业务验收。详见 [DEV 联调回执](app-v1-dev-integration-receipt-20261014.md)。

## 正式接入前置

1. 将 `config.uts` 切换为审核后的正式 HTTPS Gateway、issuer 和正式 PUBLIC Client ID，不能沿用 Android DEV 客户端或填入管理员 Token/client secret。
2. 注册正式客户端的 Authorization Code + S256 PKCE、`profile` scope 和精确回调。`com.rigour.workbench://auth/callback` 仍是正式回调合同，本轮 DEV 注册不证明它已在正式 IAM 生效。
3. 将公司 scheme 配置进自定义基座/签名安装包，或使用已验证 App Link；确认只有可信的公司包承接。标准调试基座的 `uniappx` 回调不等于正式包能力，热更新源码不能补入 Android Manifest 配置。
4. 三端各自验证系统浏览器及冷/热启动回调。目前仅 Android 实现公司登录，iOS、HarmonyOS、Web 仍未接入。
5. 真实 IAM 用户须具备相应平台角色/权限，Sales 还需员工与销售画像投影及生效规则。403 保持无权限，不能以全租户管理员身份或临时打卡身份替代销售验收。

## 验收范围

必须用签名测试包验证：浏览器登录返回、错误密码、取消、过期、重复回调、错误 state、退出后旧响应不恢复登录、网络中断、App 被杀后重新登录、不同员工权限边界。仅编译成功或模拟网络检查不能代替真实 IAM 登录验收。

在仓库根目录执行 `npm run app:v1:test`，本轮 86 项 JS 检查全部通过，覆盖原生能力的模拟状态、13 项登录/生命周期检查、统一 API/DEV 配置边界、无损 JSON、商务草稿与拜访状态。API 测试已独立到 `scripts/test-app-api.cjs`，JSON 测试在 `scripts/test-app-json.cjs`，不再混在登录测试中。

`api.uts` 使用文本响应，经 `json.uts` 保留超过 JavaScript 安全整数范围的整数字面量，再解析为对象，避免订单/客户编号先失精。401、403、网络失败分别处理，公开 Sales 错误使用固定中文白名单，不展示后台原始错误或堆栈。旧会话成功、401 和网络回包不能恢复或清除新会话。

`onAppShow` 修复后的三平台编译均通过：Android 14:33:11，iOS 14:37:26（`/tmp/sales-app-ios-auth-callback-build.log`），HarmonyOS unsigned HAP 14:44:08（`/tmp/sales-app-harmony-auth-callback-build.log`）；鸿蒙尚未配置签名证书。Android 手机已同步并完成上述管理员登录与只读页面验证。早先“基座无响应”和锁屏时调试服务启动受限的问题不再代表当前同步状态。JS 测试使用模拟网络和 Node crypto；三平台编译及管理员登录不证明 iOS/HarmonyOS 认证、真实销售身份或员工数据范围已经通过。日志与时间见 [DEV 联调回执](app-v1-dev-integration-receipt-20261014.md)。

## 官方依据

- [DCloud App 生命周期与 scheme](https://doc.dcloud.net.cn/uni-app-x/collocation/app.html)
- [DCloud 启动参数](https://doc.dcloud.net.cn/uni-app-x/api/launch.html)
- [DCloud UTS 调用 Android 原生库](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-for-android.html)
- [DCloud UTS 字节数组与原生类型](https://doc.dcloud.net.cn/uni-app-x/uts/data-type.html)
- [DCloud Android 原生资源与 URL scheme](https://doc.dcloud.net.cn/uni-app-x/collocation/app-nativeresource-android.html)
- [DCloud iOS scheme 需打包生效](https://doc.dcloud.net.cn/uni-app-x/collocation/manifest-ios.html)

三端原生加密/安全存储、稳定回调及会话撤销仍需独立验证。本轮仅在隔离 DEV 注册 Android 调试客户端，未修改生产临时打卡、未新增数据库迁移，未为测试账号冒用销售身份绑定。
