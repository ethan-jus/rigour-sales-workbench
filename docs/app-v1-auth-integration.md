# App V1 公司登录接入

日期：2026-10-14。实现：`app/services/auth.uts`。这是原生登录接入代码，不是可用生产账号的验收证明。

## 当前行为

- Android：使用 `java.security.SecureRandom` 生成独立 32 字节 verifier 和 state；原生 SHA-256 计算 S256 challenge；Base64URL 无填充编码；通过 `ACTION_VIEW` 打开系统浏览器。
- OAuth 请求只申请 `profile`，不申请 `openid`，不使用或解码 ID Token；交换得到 Access Token 后，通过配置的可信 HTTPS Gateway `GET /api/v1/me` 验证公司租户员工身份，并读取平台权限。
- discovery 的 issuer 必须匹配配置，authorization/token endpoints 必须与配置 issuer 同 HTTPS origin；Gateway 必须是无路径的 HTTPS origin。不接受凭据内嵌 URL、隐式授权 Token 回调、重复查询参数、非精确回调、state 不匹配或过期回调。
- state/verifier 和 Access Token 仅在进程内存中。登录等待 5 分钟自动终止，同一授权回调只交换一次，退出会取消在途登录结果。错误提示不包含 code/verifier/token、完整回调或服务端错误原文。
- session 失效要求重新登录。本轮不保存、不使用 Refresh Token；若服务端返回 refresh_token 也不落盘。
- `logoutCompany()` 清除本 App 会话，不声称已经撤销其他客户端或系统浏览器的公司登录。后续全局退出/撤销应增加对应 IAM 合同及验收。
- iOS、HarmonyOS、Web 暂返回“此系统的公司登录仍在接入中”，不回落演示身份或不安全随机数。页面可跨端编译不代表三端认证已经就绪。

## 接入调用

```uts
import { beginCompanyLogin, handleAuthCallback, logoutCompany } from './services/auth.uts'

// 登录按钮由页面显示失败文案；success 后跳转工作台。
beginCompanyLogin(() => { /* 导航工作台 */ }, (message) => { /* 展示错误 */ })

// App.uvue 的 onLaunch / onShow 检查 appScheme / appLink：
// 若非空，原样交给 handleAuthCallback；不要写日志。
handleAuthCallback(callbackUrl)

// 用户显式退出当前 App。
logoutCompany()
```

首次普通启动没有授权状态，不会自动登录。浏览器返回后，如果 App 进程仍存在，内存里的 verifier 可用于安全交换；若系统杀死进程，回调会要求重新发起登录。这是未引入安全状态存储的明确限制，不能把它说成支持进程被杀后的登录恢复。

## 联调前置

1. 在 `config.uts` 填写已审核的 Gateway HTTPS origin、精确 issuer、实际 PUBLIC Client ID。现有空配置会阻断登录；不能填管理员 Token 或 client secret 代替。
2. 注册移动客户端，开启 Authorization Code + S256 PKCE，允许经过验证的 `profile` scope；精确白名单 `com.rigour.workbench://auth/callback`。当前该字符串只是预定合同，不是注册完成证据。服务端若不接受不带 openid 的授权，需补齐真正 OAuth 客户端配置或改为完整验证的标准 OIDC，不能忽略 ID Token 校验绕过。
3. 将 App scheme 配置进 Android 自定义基座/签名安装包，回调 scheme 为 `com.rigour.workbench`，host `auth`，path `/callback`。先确认对应手机上只有可信的公司包承接该 scheme；后续可改为已验证 App Link。
4. 在 App 启动和回到前台时转交 `appScheme/appLink`。标准调试基座自己的 scheme 不等于公司 App scheme，热更新源码不能补入 Android Manifest 配置。
5. 真实 IAM 用户须具备相应平台角色/权限，Sales 还需员工与销售画像投影及生效规则。403 保持无权限，不能申请一个全租户管理员账号做销售验收替代。

## 验收范围

必须用签名测试包验证：浏览器登录返回、错误密码、取消、过期、重复回调、错误 state、退出后旧响应不恢复登录、网络中断、App 被杀后重新登录、不同员工权限边界。仅编译成功或模拟网络检查不能代替真实 IAM 登录验收。

在仓库根目录执行 `node --test scripts/test-app-v1-auth.cjs` 可复跑 19 项检查，使用项目的 TypeScript 依赖，无临时目录依赖。其中 12 项协议检查覆盖：空配置阻断、跨来源 discovery 阻断、S256 challenge 对照、Token 响应不能跳过 `/me`、错误 state、重复回调、重复参数、过期、退出后的延迟响应、错误回调路径、隐式 Token fragment、非公司租户身份。另 7 项统一 API 检查覆盖：401 清除会话、403 保持会话并提示权限、切换账号后的迟到成功/401 均不能影响新账号、网络超时与 503 不伪装成空成功、过期令牌不发送请求。该检查把原生 crypto 替换为 Node crypto 并模拟网络，只验证协议分支，不证明 UTS 原生编译、真机随机源、真实 IAM 或三端认证已通过。

## 官方依据

- [DCloud App 生命周期与 scheme](https://doc.dcloud.net.cn/uni-app-x/collocation/app.html)
- [DCloud 启动参数](https://doc.dcloud.net.cn/uni-app-x/api/launch.html)
- [DCloud UTS 调用 Android 原生库](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-for-android.html)
- [DCloud UTS 字节数组与原生类型](https://doc.dcloud.net.cn/uni-app-x/uts/data-type.html)
- [DCloud Android 原生资源与 URL scheme](https://doc.dcloud.net.cn/uni-app-x/collocation/app-nativeresource-android.html)
- [DCloud iOS scheme 需打包生效](https://doc.dcloud.net.cn/uni-app-x/collocation/manifest-ios.html)

三端原生加密/安全存储、稳定回调及会话撤销将独立验证；本轮没有增加不可信认证服务或写入 Platform 账号/客户端配置。
