# 销售 App 自动员工身份接入

2026-10-23。沿用已确认的原生 IAM 登录与界面，性能专项保持暂停。

用户要求登录后自动判断身份，不提供指定验收账号、不在 App 手动选择/绑定员工。因此登录/恢复成功后，App 自动调用 `POST /api/v1/sales/me/profile`，服务端依据 IAM 当前用户及 HR 工号/Long ID 核验并幂等初始化销售档案。请求不携带员工、用户或租户选择参数。

“我的 → 账号与设置”显示服务端核验的员工姓名、工号及身份状态。正常过程无开通按钮；失败可重新识别。没有销售权限的账号不发起同步，没有有效员工信息的账号明确提示原因。原生 IAM 登录自身仍可正常完成，Sales 未就绪不伪装成登录失败。

首次本人拜访、门店及统计读取共用等待中的身份同步；失败不请求后续业务。退出或切换账号会清空身份展示，旧响应和排队请求不能进入新账号。有效员工档案不代表已有门店分配、外勤规则或正式拜访提交能力。

相关源码：`app/services/sales-profile.uts`、`app/App.uvue`、`app/pages/work/work.uvue`；接口的底层认证/刷新仍复用 `api.uts`，不新增 Token 或身份缓存。API 新增 `hrEmployeeId` 字符串，历史 `employeeId UUID` 对新 HR 档案为 null；旧 H5 类型同步兼容。

后端合同与部署前提见 Platform `docs/SALES_APP_EMPLOYEE_IDENTITY.md`。App 更新依赖 Sales V28 与新接口上线；当前本机正在运行的隔离服务未替换。未改临时网页打卡，未自动创建签到、拜访或门店归属。

验证：141 项 App 回归通过，0 跳过；Android 原生编译通过。iOS/纯鸿蒙本轮未编译或真机验收，安全登录仍沿用原有能力边界。手机未连接，真实普通销售登录、HR 资格、规则与门店闭环尚待联调。


## 日常开发目录（2026-10-23 修正）

本次代码已合并回 `/Users/ethan/myspance/rigour/B2B供应链/自动化系统构建/06_代码工程/rigour-sales-workbench` 的 `dev` 分支。HBuilderX 打开此目录下的 `app/`，后续直接在这里开发；使用其他工作树须先说明并征得用户同意。原有 `ios/App/App/AppDelegate.swift` 修改原样保留。

后端使用同级 `rigour-supply-chain-digital-platform` 主工程，沿用原有 IDEA `GatewayApplication`（26880）、`IamApplication`（26881）、`SalesApplication`（26886）运行项。不再使用额外 App 本地运行项或独立 JAR。

App Gateway 和 issuer 已改为 26880/26881，精确 HTTP 白名单同步调整，旧端口被拒绝。Android 调试需设置 ADB reverse 26880/26881。安全会话按 issuer 隔离，切换后需重新登录，不搬运旧 refresh token。

IAM `application-dev.yml` 开启原生登录，仅允许 `rigour-sales-app-android-dev`；该 PUBLIC 客户端已存在且有效，bootstrap 明确关闭。生产默认仍关闭。现有 IAM 尚未重启加载此设置，真实登录与自动身份识别还未验收。

**IAM 重启前阻塞**：只读 Flyway 校验发现 V139 CHECKSUM_MISMATCH（DEV -812060856 / 本地 466362980），且 DEV V141 原始文件尚未进入主源码。需取得对应原始迁移并按环境历史解决，不能 repair 或关闭校验。当前不要求用户盲目重启 IAM；Gateway、Sales 无需为此次地址改动重启。

旧 5 个 App JAR 已按用户要求停止；主项目 7 个 IDEA 服务保持原 PID、health=UP。多余运行项已删除。最新验证 App 141 项、Android 编译通过；IAM 8 项定向测试通过。未修改员工、权限或登录会话数据。
