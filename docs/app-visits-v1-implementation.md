# 拜访页 V1 实现与验收

> 2026-11-13 更新：根页布局已被用户确认的[拜访页 V2](app-visits-v2-implementation.md)取代，记录查询移至右上角历史入口。下文保留 V1 历史验证事实。

2026-11-12。用户确认效果图后在原仓库 `app/` 实现，无新工程副本或 worktree。手机为 Redmi M2007J22C / Android 12，HBuilderX 5.26 VDOM。未发布生产。

## 页面与接口

- 根页：拜访记录／拜访计划；今日／本月／上月和日期选择；一行拜访、有效、新增；真实状态、完整历史地区地址、时间与时长；搜索、筛选、分页；条件显示进行中及本机待处理材料。开始按钮采用图钉播放描边图，底部采用剪贴板勾选图。
- 现场页：紧凑录音条、可展开录音片段、照片、接待人、沟通结果、意向、草稿和完成入口。完成必须先成功保存结果，再调用原离店流程。保留原录音、自动离店、上传、照片返回和幂等处理，不改变核验规则。
- 首页拜访统计与下钻改为复用同一查询。统计不把 Sales 离店当作 CRM 有效，新增按本人首次拜访门店计算。
- 查询链路：App → Sales `GET /api/v1/sales/me/visit-workbench` → CRM `GET /api/v1/crm/store-visits/me`。Sales 做工作台入口与授权编排，CRM 在自身数据源查询正式事实和核验状态。跨服务沿用 Nacos 寻址和签名调用者上下文；未增加事实表、同步任务或重复保存拜访。
- CRM 查询限定租户和本人，提供期间、状态、首次／有效、搜索、分页与独立期间汇总；历史摘要使用拜访时的门店快照。现场采集继续由 Sales 提供，当前联系人、CRM 记录和接待人仍使用现有 CRM 领域接口。

## 真实验收

- dev：真机加载两条本人历史记录，首页与记录页今日均为拜访 2、有效 0；历史门店在北京。当前 dev 数据范围为成都，联系人接口拒绝访问。这次没有扩大权限；修正详情加载顺序，使 Sales 已授权的门店、时间与历史摘要不会因后续 CRM 权限拒绝被丢弃，编辑区域保持关闭。
- bjdev：用户将账号改绑北京马南后，记录页成功显示本人今日／本月 0 条，没有残留 dev 的两条记录。状态筛选、计划今日／明日与空态在真机检查。
- bjdev 计划最初返回员工绑定冲突。只读查明 IAM 已为马南（41），Sales 空档案仍是赵奕然（178）。用户明确授权后，仅将该 DEV 空档案的 HR 引用、工号和来源版本同步为马南。修改前锁定并检查拜访、计划、考勤、团队关系和客户分配均为 0；未修改角色、地区范围及历史业务数据。数据库提交后，真机重试计划查询成功。
- DEV 备份位于工作区 `outputs/app-ui-20261112/bjdev-sales-profile-before.json`，权限 0600，不纳入仓库。
- Android 原生分隔线最初缺少 border-style，已修正并在真机确认；统计分隔线采用独立细线，维持 48px 点击区。
- 日期选择器初始出现 1970 年；按 DCloud picker 合同提供完整起止日期，并随计划日期重建选择器。真机确认默认选中今日／明日，以及选择 2026 年 10 月后页面与查询同步。实现依据：[DCloud picker 文档](https://doc.dcloud.net.cn/uni-app-x/component/picker.html)。

## 自动化与构建

- `pnpm app:v1:test`：257 项通过；包含账号隔离、过期响应、缺失统计不显示成功的 0、服务端过滤、保存失败不离店、无权访问材料时保留已授权摘要。
- CRM `JdbcStoreVisitQueryStoreTest`：3 项真实 MySQL Testcontainers 集成测试通过，覆盖本人／租户隔离、分页、关键词、首次拜访与并列时间、活跃记录独立于历史期间、离店与有效状态区分。
- Sales `HttpCrmStoreVisitClientTest`：7 项通过，包含新查询编码与 CRM 回执缺失处理。
- Android 编译并同步真机；iOS 模拟器目标编译成功；HarmonyOS 编译和未签名 HAP 制作成功。后两项不代表真机验收。
- uniapp-x official 静态审查两个拜访页面，无已知风险；静态检查不能替代设备验收。
- `ReactorArchitectureTest` 6 项服务依赖／模块边界检查通过。
- 全仓 `./mvnw verify` 已执行，以 IAM 模块 4 项断言失败退出：菜单计数 `supply.integration.%` 预期 5、实际 6；两项迁移末版本预期 149、实际 152；一项后续迁移数预期 17、实际 20。本次未改 IAM 代码或迁移，不调整其他任务的断言；全仓检查未通过，后续模块被 Maven 跳过。本次 CRM／Sales 的 10 项定向测试和 6 项模块边界测试单独通过。

## 验收边界与已知限制

- 本次手机授权为只读，没有新建拜访、录音、拍照、提交结果或完成离店。因此现场作业新布局的完整运行态、键盘、照片返回与提交链路没有本轮真机覆盖；现有行为由自动化回归保护，不能标成真机全流程通过。
- 两个测试账号的计划列表均无记录，计划行的真实点击流程尚缺数据验收。
- 现有 Sales 计划引用旧门店 UUID，而 CRM 正式门店为独立 store_id，缺少可靠关联。未按名称自动匹配客户或伪造计划完成：未关联的“去拜访”进入带门店名搜索的本人客户选择，需明确选择客户；已有 visitId 的计划沿用旧详情。若要实现图稿中从计划直达正式客户并自动回写计划完成，仍需补齐正式身份映射与后端关联合同。
- 正常历史详情还需用具备该客户权限且本人有记录的测试账号复查。当前北京账号没有拜访记录，成都账号只有权限范围外的历史测试门店。

设计依据与原图见 `design-system/rigour-sales-workbench/pages/visits-v1-proposal.md`、`outputs/app-ui-20261112/visits-v1-design.png`。真机截图保存在同一 outputs 目录，文件名明确标识账号与场景。

## 证据文件

- 最终记录页：`outputs/app-ui-20261112/visit-records-final.png`。
- 计划今日／明日：`outputs/app-ui-20261112/visits-plans-bjdev-today.png`、`visits-plans-bjdev-tomorrow.png`。
- 正确初选今日／明日：`visit-date-explicit-bounds.png`、`visit-date-tomorrow-fixed.png`；历史月份实际切换：`visit-historical-month-final.png`，均在同一 outputs 目录。
- 本机检查日志：`/tmp/visit-all-tests-final.log`、`/tmp/visit-backend-boundary.log`、`/tmp/visit-architecture-test.log`、`/tmp/visit-platform-verify.log`、`/tmp/visit-device-final.log`、`/tmp/visit-ios-final.log`、`/tmp/visit-harmony-final.log`。日志可能被系统清理，实际结论以上文为准。
