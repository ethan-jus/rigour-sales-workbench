# App V1 原生账号登录与 IAM 续期

更新：2026-10-14。用户确认采用 App 自有账号密码页面，供应链 IAM 继续统一认证、权限、登录过期与 Token 刷新。本次替代了此前 Android 浏览器跳转登录；原生登录的验收结果与此前浏览器登录证据分开记录。

## 实现合同

- `pages/login/login.uvue` 为原生账号、密码、显示/隐藏密码与登录状态页面。用户名提交前去空白；密码不做 trim、不落盘，提交后和离页时清空输入框。
- `services/auth.uts` 使用 Android SecureRandom 和 SHA-256 生成 state、verifier、S256 challenge。向 IAM `POST /api/v1/auth/native-app/login` 发送账号密码和客户端/PKCE 参数；验证返回 state，再经现有 `/oauth2/token` 用 code+verifier 换取 Access/Refresh Token。
- 登录页不打开浏览器，不模拟 Web 表单，不抓取 Cookie。`redirectUri` 仍是标准 code 交换的精确绑定值，不再用于系统 scheme 回调。
- 只申请 `profile`，不使用 ID Token。获取 Access Token 后调用可信 Gateway `/api/v1/me`，确认 TENANT、用户、租户及权限后发布已登录状态。
- API/身份解析使用 `json.uts` 保留超出安全整数的编号；不显示服务端堆栈、令牌、密码或授权码。

## 自动续期和退出

- Access Token 仅内存保存；Android API 23+ 使用 AndroidKeyStore AES-GCM 加密 refresh 与最小身份信息，密文放在 `noBackupFilesDir`。AAD 与 key alias 按 App、环境、issuer、client 隔离，AtomicFile 原子写，存储操作串行执行。
- App 启动后先读安全凭据，完成 IAM refresh 和 `/me` 校验再恢复登录；不会把缓存用户信息直接当成已认证身份。
- `ensureAccessToken` 在到期前 30 秒或 API 401 时单飞刷新。多个并发请求共用一次轮换，每个业务请求最多因认证失败重试一次；迟到的旧 Token 401 直接使用已更新 Token，不再次消费旧 refresh。403 保持权限拒绝，不伪装成登录过期。
- 身份 revision 在退出/切号时变化，正常刷新只改变 tokenVersion。已退出或旧账号的在途响应不能恢复/覆盖新账号。
- 发送刷新前先清除旧持久凭据，成功换发并安全保存后再发布新凭据；刷新超时、进程退出或响应丢失不盲目重放旧 refresh，要求重新登录，业务草稿保留。
- 退出清本机凭据，并以当前 Bearer Token 调用 IAM 原生 logout 撤销当前 App 会话；失败会明确提示服务端退出未确认，不声称断网也已撤销服务器会话，不退出其他浏览器或 App 会话。
- 仍遵守 IAM 当前会话绝对期限。现有密码会话默认 8 小时；refresh TTL 7 天不能突破该期限，本轮没有调整公司登录策略。

`App.uvue` 启动时调用 `restoreCompanySession`；已移除旧浏览器回调和等待公司网站登录的处理。`commerce` 不再因短期 Access Token 到期抢先登出，统一交给 IAM 续期。

## 环境与平台边界

| 项目 | 配置 / 范围 |
|---|---|
| Gateway | `http://localhost:27680` |
| IAM issuer | `http://localhost:27681` |
| Client ID | `rigour-sales-app-android-dev` |
| code 交换绑定 URI | `uniappx://rigour-sales/auth/callback` |
| 连接 | Android ADB reverse；独立进程不注册共享 Nacos |
| 凭据存储 | Android API 23+ Keystore；其他系统不降级普通 storage |
| iOS / HarmonyOS / Web | 页面可编译不代表已支持原生认证，安全随机数/安全存储接入完成前明确拒绝登录 |

HTTP 只用于 development 的精确 loopback 配置，不能扩大为 LAN 地址或正式环境 HTTP。正式发布须使用公司签名包、HTTPS、独立正式 PUBLIC Client 和明确启用的 IAM 原生登录入口，不携带客户端 Secret 或管理员 Token。

原生 IAM 入口默认关闭，显式允许 App client IDs；参见 Platform `docs/SALES_APP_DEV_AUTH.md`。NATIVE_APP 会话使用 V133 扩展类型约束。2026-10-14 已合并同事 V132 原始文件、修复空库基线冲突；隔离 DEV IAM 已启用原生入口，共享 DEV 执行 V133 后 Flyway 校验成功。未改写历史 SQL 或执行 repair。

## 验收与保留边界

此前浏览器方案已由用户确认 Android 显示管理员、客户列表/详情和订单列表可读，接口也返回成功；2026-10-14 新原生入口启用后，手机登录/令牌交换/身份读取均返回200，用户明确确认原生登录成功、重开也能恢复。服务端 refresh 轮换及退出撤销另有真实 DEV 接口回执；尚未在手机上等待 Access Token 自然到期测试。原始只读业务验证记录保留于 [DEV 联调回执](app-v1-dev-integration-receipt-20261014.md)。

本轮必须分别验证：原生密码登录、错误密码与锁定、Token 到期续期、并发401单次刷新、退出后旧响应、重新打开App恢复、存储故障、网络中断、账号停用及权限变化。JS mock、Android/iOS/HarmonyOS编译、Testcontainers与真实DEV手机回执分别报告。

普通销售账号验收仍缺 IAM/HR 到 Sales 的身份契约对齐、有效画像与门店分配，管理员只读成功不能替代本人客户/订单/拜访范围验收。所有未开放写功能保持本机草稿，不报告假提交；生产临时打卡不受此次改动影响。

## 退出失败处理

退出前先按环境保存非敏感退出意图；凭据清除并确认完成状态后才提示本机退出。清除失败留在账号与设置中重试；重启不会恢复残留的旧刷新凭据。正常退出后重启只显示未登录，显式新登录安全保存成功后才移除退出标记。普通存储只保存状态，不保存密码或Token；服务端撤销失败与本机退出分别提示。
