# 工作台首页 V5 实现与验证

> 2026-11-13 更新：首页右上角已改为只读状态和定制表情，上下班打卡移到拜访页；详见[最新实施记录](app-visits-v2-implementation.md)。下文的首页签到说明仅为历史版本记录。

2026-11-11。源代码直接修改本仓库 `app/`，没有创建项目副本或 worktree。沿用已确认的 V5 视觉，并纳入用户确认的历史时间选择。

## 已实现

- 白底、石墨文字、橙色重点操作；品牌标题、经营概览、拜访与建联、四个常用操作、当前待办，整页滚动、原生固定五项 Tab。
- 常用期间为今日／本月／上月。点击右侧日期展开“本年／选择月份”。月份选择不接受未来月份，本年和当前月份截止到业务当天；业务日期按 Asia/Shanghai。
- 交易额、订单数、拜访次数、有效拜访、新增拜访统一切换期间。回款行已按最新确认替换为全款回款业绩进度，期间规则见下文。累计待回款、待出库和今日待拜访不受该期间影响。
- 交易、全款回款业绩、待回款、待出库、三类拜访统计均可进入同口径分页明细；订单行继续进入现有订单详情。今日待拜访打开当天 PLANNED／IN_PROGRESS 计划明细列表。
- 显式上班签到、继续未结束的拜访、本机拜访草稿和购物草稿保留。读取首页不会自动签到或索取定位权限。
- 加载、失败、无权限分别处理；没有数据是 0，缺失或失败是“—”，错误可重试；账号切换和期间切换的旧请求不覆盖当前状态。
- 企微建联尚无官方同步来源，当前展示“—”，点击给出未接入提示。没有把普通联系人数量、手填微信或示例值作为企微统计。

## 数据合同

订单后端原仓库 `rigour-supply-chain-digital-platform` 增加 `OrderWorkbenchApi`、用例服务、持久化端口和 JDBC 读取实现；无需新表或数据库迁移。

- `GET /api/v1/orders/workbench/summary?ownerEmployeeCode=&from=&to=`
- `GET /api/v1/orders/workbench/details?ownerEmployeeCode=&from=&to=&kind=orders|unpaid|outbound|receipts|performance&begin=0&step=20`

员工编码来自现有 Sales 身份同步结果，不取用户输入。服务端校验租户、动作权限，并叠加现有 `OrderDataScope`。交易和待办需要 `order:read`，回款需要 `order:payment:read`。

- 交易：SUBMITTED／COMPLETED 订单应收额，按 order_date，排除草稿、取消、删除。
- 累计待回款：上述有效订单中 unpaid_amount > 0，不限日期；只表示未收，不等于逾期。
- 待出库：有效订单且 PENDING／PARTIAL_OUT，不限日期。
- 原收款记录明细（receipts，首页不再使用）：关联有效订单的 RECEIVED／CHECKED 收款记录，按 payment_time 和订单归属销售统计；收款员不替代订单归属。是确认收款额，不是退款抵扣后的净回款或考核业绩。
- 日期窗口为中国时区起始日零点到结束日次日零点，右边界不含。明细总额在分页前计算。

Sales 原 `/sales/me/activity-summary` 支持期间汇总；新增 `/api/v1/sales/me/activity-visits?from=&to=&kind=all|effective|first&page=1&pageSize=20`，沿用本人 Sales 身份和门店快照。有效拜访以最终 EFFECTIVE 为准，新增拜访沿用本人对门店第一次签到口径。

## 已完成验证

- `pnpm app:v1:test`：195 项通过，包括显式签到、权限、账号隔离、旧响应、期间边界、上月跨年、闰年二月、计划状态、明细分页和精确订单跳转。
- Android、iOS 模拟器目标、HarmonyOS 编译通过；最终日志没有本次代码的编译错误。鸿蒙本地未签名 HAP 制作成功。
- Order：5 项定向用例通过，用 H2 验证租户、员工和范围叠加、取消／草稿排除、历史待回款、分页总额、按收款时间统计和权限／日期转换。
- Sales：9 项隔离 MySQL 集成用例通过，含新增 all／first／effective 明细与汇总对应验证，未跳过。
- 浏览器运行实际 UVue 页面，用本地隔离传输替身验证 375／390 宽度、长金额、日月年及历史月份切换、回款／拜访明细入口、返回保留期间、上下滑动及固定底栏、空态和错误重试入口。原项目未登录直接进首页会回到登录页。
- 核心变更文件通过 uni-app x official 静态审计；两个原仓库 `git diff --check` 通过。

证据位于 `outputs/app-ui-20261111/home-v5-*.log` 和 `home-v5-*-actual-sample.png`。`home-v5-review.html` 是仓库 outputs 内的本地验收入口，使用真实页面组件，拦截全部请求并提供可识别样例，不属于 App 页面或交付包，不应作为真实业务联调证据。

## 尚未完成的外部验收

- 需要用户重启现有 IDEA 的 `rigour-order-center-service`、`rigour-sales-work-service` 后，验证真实账号接口；本次没有另起后台服务或部署 DEV／生产。
- 企微官方关系同步及真实明细尚未接入。
- 三端编译和 Web 运行不等于三端真机验收；鸿蒙 HAP 未签名。

## 后续设计建议（未擅自加入首页）

优先考虑待回款中的逾期标识（需约定收款日期）。目标进度已按用户确认的整单付清口径实现。排名、客单价、同比趋势进入详细统计，避免首页继续膨胀。

原生日期选择和安全区依据：[DCloud picker](https://doc.dcloud.net.cn/uni-app-x/component/picker.html)、[页面安全区 CSS 变量](https://doc.dcloud.net.cn/uni-app-x/css/common/function.html)。当前 HBuilderX 5.26 的 VDOM 编译器不接受 align-items: baseline，已使用 flex-end 对齐。


## 2026-11-11 业绩进度补充

用户确认：页签默认今日；今日／本月看本月目标，上月和历史月份看对应月，本年累计月指标。

- 首页原“期间回款”行替换为业绩进度：期间业绩标题、百分比、细进度条、全款回款、总指标。没有新增解释卡或其他首页模块。
- 今日、本月均按本月1日至今天统计整单付清业绩，对比本月完整指标；上月／历史月对比该月指标；本年按1月1日至今天统计，对比1月至当前月指标之和，不提前纳入未来月份。
- 订单以截至查询截止日的 RECEIVED／CHECKED 收款累计计算，扣除付清当时已确认退款，取第一次达到应收金额的时间。全款付清月份计一次整单应收额，跨月部分回款、重复收款、超额收款不会重复或提前增加业绩。排除零应收、草稿、取消、删除订单。
- 订单归属优先采用 FROZEN 快照，未固化时沿用现有薪酬事实的历史来源判断，同时叠加现有订单数据权限。相关退款或归属／质量待核定时，不展示已确认的汇总金额／比例，显示“待核定”；点明细可见对应状态。
- HR 目标使用 FULLY_PAID_RECEIPT_BASIS，已有个人月核定值（含显式0）优先，否则沿用 HR 入职阶段规则和首月免考，不以一般 RECEIPT_AMOUNT 目标代替。零指标显示0、比例为“—”；超额完成保留实际百分比，进度条最多填满。
- 新增 `GET /api/v1/orders/workbench/performance?ownerEmployeeCode=&from=&to=`，返回 completedAmount（待核定时null）、targetAmount、orderCount；同条件 `details?kind=performance` 提供分页订单。
- Order 在读取指标前使用 IAM 可信员工身份校验本人，并要求 `order:payment:read`；HR `GET /api/v1/hr/target-settings/performance-value?employeeCode=&from=&to=` 仅供带 `hr:targets:service-read` 权限的签名 SERVICE 调用，返回指定员工期间目标之和，最多12个月。App 不获取薪资方案或其他员工指标。
- 无新表、无数据库迁移；在两个原项目中修改，没有另建 worktree 或 App 工程。

验证：App 199 项自动化测试通过；Android、iOS、Harmony 编译及鸿蒙本地未签名 HAP 通过。375px 的真实 UVue Web 预览验证默认今日／本月业绩、上月、本年、超额比例、长金额、零指标、全款订单入口。样例请求全部隔离拦截，截图是测试数据，不是真实账号接口验收。

本次后端全量 verify 在未修改的 IAM 模块遇到4项断言失败（导航数量、迁移数量及V139收敛检查），详见 `outputs/app-ui-20261111/home-performance-backend-verify.log`，不代表全量通过。本次 Order／HR 定向21项通过（Order 11项、HR 10项），见 `home-performance-backend-tests.log`。

联调前需要用户重启现有 IDEA 的 **rigour-order-center-service** 和 **rigour-hr-payroll-service**，再运行本仓库 `app/`。如果此前 V5 的 Sales 明细尚未重启生效，也需重启 **rigour-sales-work-service**。本次未另启业务服务、未部署，也未执行真实账号或真机验收。

证据：`outputs/app-ui-20261111/home-performance-*.log`、`home-performance-*-sample.png`；`home-performance-review.html` 仅是本地隔离测试入口，不属于 App 路由或交付包。


## 2026-11-11 按钮与待办细节修正

按已确认 V5 图稿和本次用户反馈修正，最新要求覆盖原图稿中的客户预览：

- 开始／继续拜访恢复白色定位图标与橙色宽按钮。右侧查客户、查商品、拜访计划按联系人簿、立方体、日历图形统一线宽和大小，文字14px；上班签到补定位图标。
- 390px 页面实测主按钮约134×52px，右侧各约64×52px。图标与原生文字按钮分层，复用登录页的透明按钮覆盖方式，原生 button 内没有嵌入图像。按压反馈不改变布局。
- 当前待办统一为钱包／立方体／空白日历图标、名称、数量、箭头，64px 行高，去掉首页客户预览及相关页面状态／处理函数。待回款与待出库分别进入现有对应条件订单明细。
- 今日待拜访进入 `workbench-details?kind=plans`，通过已有本人计划 API 获取当天数据，仅列 PLANNED／IN_PROGRESS；显示门店、地址、拜访事项与状态。已关联拜访记录且拥有读取权限时可以继续查看记录；无记录的计划不显示跳转箭头。没有新增后端接口。
- 日期统计、全款业绩进度、默认今日、账号隔离、本人权限和原有快捷操作逻辑保持有效。

验证：202项 App 测试通过；Android／iOS／Harmony 编译通过，鸿蒙未签名 HAP 制作成功。真实 UVue Web 页面通过隔离样例检查375px、390px及812px横屏布局，横屏无水平溢出；待回款、待出库、今日待拜访分别可进入明细。没有替代真机验收或真实业务接口联调。

证据：`outputs/app-ui-20261111/home-polish-*.log`、`home-polish-actions-todos-375.png`、`home-polish-scrolled-375.png`、`home-polish-scrolled-390.png`、`home-polish-pending-visits-375.png`。`home-polish-review.html` 仅为本地隔离验收入口，不进入 App 包。


## 2026-11-11 首页统计区紧凑调整

按用户标注缩减金额、目标进度和拜访统计的垂直跨度：

- 金额与订单笔数同行；“6笔订单／12笔订单”简写为“6笔／12笔”，箭头移到各自标题右侧。金额达到10万后以万／亿展示，保留最多两位小数；明细仍显示完整金额。
- 业绩区保留标题和完成百分比；“回款 金额”与“指标 金额”分别置于细进度条左、右端上方，去掉原先上下两层标签和值。全款业绩统计和目标口径不变。
- 拜访统计取消重复区域标题，改为两行、每行两项：“拜访 数量／有效 数量”“新增 数量／企微 数量”。单项48px高，名称和值同行，保留原明细入口；未接入的企微仍显示“—”。
- 统一收紧统计区间距，保留已确认的开始拜访、快捷操作和待办图标。在375px隔离样例中，金额卡高181px、拜访区97px，开始拜访入口位于页面约452px处。

验证：202项 App 测试通过；Android／iOS／Harmony编译通过。实际 UVue Web 页面核对375px常规、大金额、零值和缺失值显示，金额与笔数保持同行，进度金额未溢出。本次只修改原 App 首页显示与本文档，没有调整后端接口、另建工程或部署；未进行真机验收。

证据：`outputs/app-ui-20261111/home-compact-{tests,android,ios,harmony}.log`、`home-compact-375-sample.png`、`home-compact-large-375.png`、`home-compact-empty-375.png`。`home-compact-review.html`仅为使用真实页面的本地隔离测试入口，所有请求均拦截，截图数据为示例。


## 2026-11-11 紧凑布局的模块层级修正

用户指出取消“拜访与建联”标题导致业务分组不清。本轮恢复该标题，与“当前待办”使用一致的18px／28px标题样式；业绩卡到拜访模块留24px，标题到两行数据留8px，数据到操作栏留20px。保留拜访／有效／新增／企微名称与数量同行、金额与订单笔数同行的紧凑布局，不改变统计和跳转逻辑。

375px实际UVue预览中，交易业绩卡高181px不变，含标题的拜访模块133px，开始拜访入口位于约504px处。检查了375px竖屏、812px横屏及待办滚动，横屏未水平溢出，三类待办可完整滑动查看。此次为标题与间距调整，未新增或重复执行业务单测；official静态审计及Android／iOS／Harmony编译通过，未做真机验收。

证据：`outputs/app-ui-20261111/home-sections-375-sample.png`、`home-sections-scrolled-375.png`、`home-sections-landscape.png`和`home-sections-{android,ios,harmony}.log`。截图使用现有隔离入口与示例数据。

## 2026-11-12 DEV 账号权限与 Android 入口验收

经用户授权，在现有 DEV 管理端为仅分配给 `dev` 的 `TESTSALES` 角色补充 `erp:product:read` 和 `sales:visit-plan:own:read`，同时保存商品管理的三个必需菜单祖先。数据库只读复核：角色版本由1升至2，应用设置版本由163升至164，授权节点由66增至71，没有移除原授权或改变数据范围；未修改生产环境。

实际 Android 手机的 DEV 会话已显示“查商品”“拜访计划”“今日待拜访”，今日待拜访数量为0。经用户授权使用 ADB 进行只读验收，商品列表与商品详情均加载真实数据。验收过程中因另一项进行中的拜访和录音暂停导航和安装；用户确认拜访结束后继续，拜访计划页正常显示“今天暂无拜访计划”，今日待拜访明细显示当日日期、“0项”和“暂无记录”，未出现权限或接口错误。两页均收到本人计划接口响应。本次未创建计划，因此验证范围为真实入口、接口加载和空状态，不包括非空计划行的详情操作。

真机发现主操作按钮的弹性宽度挤压右侧入口，导致标签折行。原项目将主按钮改为124px且不收缩，保留右侧三个入口平分剩余宽度。样式属性依据 [DCloud flex-shrink](https://doc.dcloud.net.cn/uni-app-x/css/flex-shrink.html)。official 静态审计、Android／iOS／HarmonyOS 编译通过，鸿蒙未签名 HAP 制作成功。恢复验收时手机已运行修正后的布局，无需再次安装；实际1080px屏幕主按钮宽341物理像素，右侧入口各187至188物理像素，三个标签均保持单行，商品、计划和待拜访入口可正常使用。

早先观察到首页交易和回款区域显示“—”及404错误，恢复验收时已能显示真实金额、笔数和指标：今日交易0元／0笔，累计待回款17,938元／77笔，本月目标7,000元；本月页签显示交易964元／3笔。当前截图与接口日志未复现此前404。本轮未重启服务，不将恢复原因归于本次权限配置。

权限落库证据见 `outputs/app-ui-20261112/dev-home-permission-verification.json`，商品真机截图为 `products-device.png`、`product-detail-device.png`，计划与待拜访截图为 `plans-device.png`、`pending-plans-device.png`，首页与完整待办截图为 `device-resume.png`、`home-todos-device.png`，相关接口日志为 `home-api-device.log`，编译日志为 `home-actions-{android,ios,harmony}.log`。所有文件位于同一输出目录。

## 2026-11-12 当前待办行距收紧

按用户截图缩减“待回款／待出库／今日待拜访”的行高。原生视图将64px最小高度与上下各16px内边距叠加，含分隔线后真机约97px；改为52px最小高度、无额外内边距，含分隔线后约53px。标题样式、图标、金额与数量、整行跳转保持原实现，三行总高度减少约132px，约45%。

official静态审计及三端编译通过，鸿蒙未签名HAP制作成功。新代码已从原项目同步到现有Android手机，实际三行分别为146／146／145物理像素（设备密度2.75），图标、名称和数量垂直居中，整行仍可点击。证据位于 `outputs/app-ui-20261112/`：`todos-compact-final-device.png`、`todos-compact-ui.xml`、`home-todos-compact-ios.log`、`home-todos-compact-harmony.log`、`home-todos-compact-android-device.log`。本轮仅修改待办行样式，不新增或重复执行业务单测。


## 2026-11-19 月度经营目标来源修正

用户确认：只改目标来源，保留整单结清月份、按回款人贡献计入完成值的规则。本节覆盖 11 月 11 日关于首页使用薪酬 `FULLY_PAID_RECEIPT_BASIS` 目标的旧约定；薪酬模块自身的阶段规则不变。

- 首页销售指标来自 HR 月度经营指标的 `SALES_OWNER / SALES_AMOUNT`，回款指标来自 `SALES_OWNER / RECEIPT_AMOUNT`。两者按本人员工编码和所选月份读取；显式设置的 0 也有效，缺省时沿用月度经营指标页自身的默认规则。APP 和 Order 不设置固定的 40,000、20,000 或 7,000。
- HR 新增签名 SERVICE 接口 `GET /api/v1/hr/target-settings/business-values?employeeCode=&from=&to=`，返回 `salesTargetAmount`、`receiptTargetAmount`。复用后台月度指标的有效值解析；最多累计 12 个月，保留租户、员工和服务权限限制。旧 `/performance-value` 为已运行的旧 Order 保留兼容，返回同源的回款经营目标。
- Order `summary` 新增 `salesTargetAmount`，读取 HR 前核对本人身份；`performance.targetAmount` 改读回款经营目标。`completedAmount` 和明细的整单结清/回款人贡献 SQL 不变。HR 目标在订单聚合缓存之外读取，后台更改后下一次成功请求即可更新。
- 首页交易额下新增对应期间的销售指标；业绩区将“指标”标为“回款指标”。今日仍展示本月目标，上月/历史月取对应月份，本年累计 1 月至当月。两个目标沿用现有首页并行请求，不新增 APP 请求。
- 首页订单和业绩展示缓存采用新的 `business-targets` 键，避免显示旧薪酬目标快照；继续按环境、租户、用户、权限和日期隔离，实时刷新失败清除。无数据库迁移、生产操作、安装或临时打卡数据删除。

验证状态：后端 28 项定向检查、APP 409 项测试通过；包含目标默认/覆盖/零值/跨月、服务鉴权、本人约束、错误响应、旧缓存隔离和期间/账号切换。完整编译及 DEV 运行验收结果见后续验收记录；本节不表示生产已生效。


2026-11-19 DEV 补验：合并后的 IAM V158/159/160 已成功且健康，正常原生登录/PKCE 后，当前 dev 员工的 summary/performance 本月目标为 40000/20000，上月一致，本年累计 440000/220000；六个请求 HTTP200，跨员工请求403。完成值按原整单结清口径返回。账号当前绑定向韬，张松的 DEV 个人经营目标无覆盖、由同一 HR 默认逻辑提供40000/20000；未伪装为张松登录验收。临时验证会话已注销。手机生产配置及安装包没有变更，生产展示未发布/验收。
