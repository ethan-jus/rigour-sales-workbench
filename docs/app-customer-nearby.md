# 客户距离排序与自动更新

实施日期：2026-11-13。原项目本地 DEV 开发，未发布生产。20:25 用户追加要求优化首次定位等待、列表加载及缓存体验；当前实现以本文后续性能修正为准。

## 已实现行为

- 公海、我的客户、合作客户默认按当前位置的直线距离升序，最近的先显示。原有地区、关键词、客户阶段、保护状态、归属状态及历史合作权限保持生效。
- 手机进入列表时先显示最近匹配缓存并重新校验；无缓存则列表查询和定位并行，先显示普通名单，明确提示定位后按距离排序。页面在前台时每 30 秒更新位置及距离；离开页面停止此定时器。这与工作日后台轨迹采集是不同职责。
- 自动更新只改距离，不突然移动销售正在查看的行。距本次排序位置移动至少 100 米时，提示「位置已变化，刷新后重新排序」；点击「刷新附近」重新定位并从第一页排序。切换列表或筛选也使用最近成功定位重新查询。
- 显示约 50 米内、约 N 米、约 N.N 公里，属于直线距离，不是驾车导航路程。缺失／无效坐标排在末尾并显示「距离未知」。定位失败明确说明默认顺序或上次位置距离，不伪装成当前位置。
- 原生 WGS84 定位通过 CRM → Integration 的既有高德标准化接口转换，GCJ02 门店与转换后的点计算，WGS84 门店与原始点计算，不混用坐标系。
- 每页 20 条。继续翻页锁定首次查询位置，用距离和门店 ID 游标；移动后不把新位置与旧页拼接。切换账号／权限、隐藏页面时丢弃旧异步结果。

## 17 万条数据如何处理

范围先由后端鉴权、租户、地区和业务筛选确定。数据库使用已有 `ix_store_map_coordinates(tenant_id, longitude, latitude, id)` 坐标索引，从 2 公里范围框开始查候选；候选不足时逐级扩大范围，对候选计算准确球面距离，再取当前页。

总量不超过一页的小名单直接使用现有归属／业务索引筛选并计算距离，避免为一两家客户反复扩圈。总数仅作查询计划提示，仍取 size+1 判断下一页，计数过期不会截断查询结果。

本次没有新建空间表、搜索集群或缓存全量客户，也没有新增数据库迁移。MySQL 返回各坐标系最多 21 个候选，Java 合并的距离候选最多 42 个，再读取当前页的门店资料；手机只接收当前页并使用原生 `list-view`。总数查询复用既有范围和短期缓存。

这不是把 17 万条传给 App 排序，也不是只将普通分页取到的 20 条重新排序。偏远地区、很窄的业务筛选或很深的页会扩大候选范围，仍可能需要更多数据库工作，不能承诺任何情况下都只扫描几十条。后续扩大数据量应按真实查询计划评估专用空间索引，不能仅凭数据总量推断需要另建服务。

### 实际数据库验证

DEV 当时有 170,117 家门店，坐标均为 GCJ02。下面是调用实际附近查询实现的只读测量；不含授权解析、总数、资料装配、坐标标准化和手机网络。

| 固定公开样例位置 | 首次 20 条 | 下一页 20 条 |
| --- | ---: | ---: |
| 成都 | 108 ms | 100 ms |
| 北京 | 196 ms | 102 ms |
| 上海 | 193 ms | 108 ms |
| 稀疏地区 | 393 ms | 106 ms |

成都样本的 `EXPLAIN ANALYZE` 显示索引范围扫描 375 条、经范围框筛出 61 条再关联业务状态，并非全量逐条计算距离。测量只代表本次 DEV 单次样例，不是并发压测、生产 SLA 或全国任意筛选的保证。

证据：[查询性能与执行计划](../../rigour-supply-chain-digital-platform/outputs/customer-nearby-20261113/database-performance.log)。

## 实现入口

- App：[附近接口与距离格式](../app/services/customer-nearby.uts)、[客户行模型](../app/services/customer-workbench.uts)、[客户名单](../app/pages/customer-list/customer-list.uvue)。
- CRM 接口：`GET /api/v1/crm/stores/nearby`、`GET /api/v1/crm/stores/nearby/origin`、`GET /api/v1/crm/customer-workbench/nearby`。
- Backend：`NearbyModels`、`StorePoolController/Service`、`CustomerWorkbenchController/Service`、`NearbyStoreQuery`、`JdbcStorePoolStore`、`JdbcCustomerWorkbenchStore`、`HttpStorePoiClient`。
- 附近位置参数与原列表业务参数分别绑定，显式使用 `@ModelAttribute("near")`，避免两个 `Query` 类型默认绑定名冲突。用户已重启现有 IDEA CRM 26883，使修复生效。

## 已完成验证

- 性能修正后的原生自动化测试 299/299 通过，包含坐标系、返回结构、位置更新与顺序分离、固定位置翻页、定位失败、切号／离页旧回调丢弃、地区查询不阻塞名单、加载地区时切换名单的旧响应隔离，以及附近响应到达前不把普通名单标成距离排序。
- 性能修正后后端定向测试 24/24 通过，包含位置与筛选缓存隔离、当前权限重新校验、认领使公海／私海缓存失效、缓存序列化，以及小名单查询往返次数与过期总数不会截断结果。早期 14、8、17 项为分阶段记录，不累计为一次全量结果。数据库测试使用本任务创建并清理的隔离 schema，没有改真实门店／订单数据。
- Android 编译和自定义基座同步成功；iOS 模拟器目标编译成功；HarmonyOS 编译和未签名 HAP 制作成功。后两者不代表真机验收。
- `customer-nearby.uts`、客户名单的官方规则静态审计无已知告警；它们不替代上述实际编译。

### 初版 Redmi 真机记录（性能修正前）

2026-11-13 20:09 起，Redmi M2007J22C，沿用当前已登录 DEV 账号，只读验收。

- 公海真实授权范围 2,359 家；首屏距离约 620 米、630 米、630 米，顺序由服务端确定。截图：[首屏](../outputs/customer-nearby-20261113/public-loaded.png)。
- 更新时间从 20:09:50 自动变为 20:10:20、20:10:50，原有行保持位置；日志仅出现位置标准化请求，没有因自动更新重新请求整页。截图：[自动更新](../outputs/customer-nearby-20261113/public-auto-update.png)。
- 滚动触底触发下一页真实请求，返回成功。首屏附近 API 网络计时 810 ms，第二页 1,005 ms；这是设备请求计时，包含本地调试链路、网关和服务，不能与上面的 SQL 时间混为一谈。首次原生定位约 12 秒，另加标准化约 1 秒；首次进入的整体等待不等于单页 API 耗时。
- 初始概览我的客户／合作客户均为 0 家；用户自行操作手机后，我的客户变为 1 家，20:18 只读观察该店约 610 米，公海计数变为 2,358 家。截图：[我的客户](../outputs/customer-nearby-20261113/mine-loaded.png)、[合作客户空态](../outputs/customer-nearby-20261113/cooperated-empty.png)、[下一页](../outputs/customer-nearby-20261113/public-page-two.png)、[手动刷新](../outputs/customer-nearby-20261113/public-refreshed.png)。未由助手提交认领。
- 多家私海／非空历史合作列表、真实步行超过 100 米、定位拒绝与断网恢复尚未完成本次真机覆盖；对应自动化用例不能冒充真机记录。北京地区选择中「全部城市」下没有城市项，尚未验证直辖市区县筛选，属于原有地区选择路径，未在附近排序任务中修改。
- 本批没有提交认领、拜访、签到或订单，没有修改当前账号权限。

日志：[App 测试](../outputs/customer-nearby-20261113/app-tests.log)、[设备编译与接口计时](../outputs/customer-nearby-20261113/device-compile.log)、[iOS 编译](../outputs/customer-nearby-20261113/ios-compile.log)、[Harmony 编译](../outputs/customer-nearby-20261113/harmony-compile.log)、[后端 14 项](../../rigour-supply-chain-digital-platform/outputs/customer-nearby-20261113/backend-tests.log)、[接口绑定回归](../../rigour-supply-chain-digital-platform/outputs/customer-nearby-20261113/controller-tests.log)。

## 20:25 后的性能修正

初版两个直接问题：串行等待 12 秒定位后才查列表；小名单不足 21 条时一直扩大到全球才能确认没有更多结果。用户明确要求从实现、接口、SQL 和缓存一起优化。

- 列表与定位并行；无位置时先展示默认顺序，不声称已经按当前距离排序。匹配的首屏缓存立即用于显示，随后后台重新校验，刷新不清空已展示的行。普通网络／5xx 更新失败可保留当前资料并明确报错；权限等错误仍清除数据。
- 附近列表采样窗口使用 3,000 ms，保持 WGS84、精度校验与服务端标准化。现场打卡原有 12 秒定位窗口不变。依据 [DCloud 定位参数](https://doc.dcloud.net.cn/uni-app-x/api/get-location.html)，3,000 ms 为支持的高精度窗口；实际返回速度仍以设备测量为准。
- 30 秒内跨列表复用定位结果；同时进行的定位／相同查询合并。位置只在隔离的短期内存缓存中保留，不新增落盘精确位置。
- 复用 `customer-cache.uts`：环境、租户、账号、会话、权限隔离，最多 12 个快照、2 分钟；首屏按筛选存储，带游标的下一页不会覆盖首屏。公海地区资料使用同一短期缓存；首次地区、名单、定位并行，地区元数据不阻塞名单，也不在晚返回时暗改正在查询的筛选。唯一授权地区仅作为默认显示标签，完整授权范围仍由后端约束。
- CRM 附近页使用现有 QueryCache 缓存 10 秒，键包含授权范围、行政区版本、完整筛选、位置与游标；读前仍鉴权。认领等写入调用现有版本失效机制。
- 1 家客户的实际数据库查询：旧扩圈 4,450 ms；修正后 293 ms、215 ms。见[小名单性能对比](../../rigour-supply-chain-digital-platform/outputs/customer-nearby-20261113/small-scope-performance.log)。这是查询计时，不含手机渲染和网关。

性能修正日志：[App 299 项](../outputs/customer-nearby-20261113/performance-app-tests.log)、[前端 31 项定向测试](../outputs/customer-nearby-20261113/performance-tests.log)、[后端 24 项](../../rigour-supply-chain-digital-platform/outputs/customer-nearby-20261113/performance-backend-tests.log)、[Android 编译](../outputs/customer-nearby-20261113/performance-android-compile.log)、[iOS 编译](../outputs/customer-nearby-20261113/performance-ios-compile.log)、[Harmony 编译](../outputs/customer-nearby-20261113/performance-harmony-compile.log)。31 项为 299 项中的定向子集，不额外相加。

### 最终性能版 Redmi 真机记录

现有 IDEA CRM 已于 20:33:48 重启，编译文件时间一致，健康检查 UP；没有另起服务。最后一版 App 于 20:43 差量编译同步成功。以下为 20:44–20:48 同一 Redmi、真实 DEV 接口的只读检查：

| 场景 | 结果与证据 |
| --- | --- |
| 无列表缓存首次进入公海 | 页面日志到 20 条数据交付 1,341 ms，其中普通名单请求网络计时 1,025 ms；点击后约 2.5 秒发起的[截图](../outputs/customer-nearby-20261113/accepted-cold-2500ms.png)已显示名单，正确标注默认顺序及后台定位。此计时不是第一帧渲染测量。 |
| 首次定位完成后附近排序 | 定位标准化返回后保留现有名单，附近页数据在进入后约 5.7 秒交付；[7 秒截图](../outputs/customer-nearby-20261113/accepted-nearest-7000ms.png)显示 620／630／820 米，标注「离我最近」。GPS、标准化、附近页仍需时间，期间名单可查看。 |
| 我的客户首次附近查询 | 当前真实 1 家，数据交付 1,088 ms（API 网络计时 984 ms）；[截图](../outputs/customer-nearby-20261113/accepted-mine.png)显示约 620 米，无原先约 4 秒的 SQL 扩圈等待。 |
| 合作客户 | 当前真实 0 家，数据交付 1,042 ms；[截图](../outputs/customer-nearby-20261113/accepted-cooperated.png)正确显示空态。未制造非空合作数据。 |
| 缓存内切换名单 | 我的客户／公海缓存数据分别在 1／5 ms 完成赋值；点击后约 0.3 秒发起的[我的客户截图](../outputs/customer-nearby-20261113/accepted-mine-warm-300ms.png)、[公海截图](../outputs/customer-nearby-20261113/accepted-public-warm-300ms.png)均已有列表，后台继续校验。截图命令自身约 0.7 秒，不将赋值时间当作用户感知渲染时间。 |
| 离页后重新进入公海 | 首屏 20 条缓存赋值 6 ms；[点击后约 0.4 秒发起的截图](../outputs/customer-nearby-20261113/accepted-public-reentry-400ms.png)已有附近列表，后台继续刷新。 |
| 手动刷新 | [定位期间](../outputs/customer-nearby-20261113/accepted-refresh-preserves-rows.png)客户列表保持显示；[刷新完成](../outputs/customer-nearby-20261113/accepted-refresh-complete.png)距离时间更新，未出现整页清空。 |

点击至截图采集开始／结束的时间分别记录在[首次进入](../outputs/customer-nearby-20261113/accepted-device-timing.json)、[缓存切换](../outputs/customer-nearby-20261113/accepted-warm-timing.json)、[手动刷新](../outputs/customer-nearby-20261113/accepted-refresh-timing.json)、[重新进入](../outputs/customer-nearby-20261113/accepted-reentry-timing.json)。设备接口日志见[本次完整日志](../outputs/customer-nearby-20261113/device-compile.log)。以上是本地调试链路下的单次实测，不是生产并发或 SLA；当前手机已同步最终版本，无需重装。多家私海／非空合作、真实移动超过 100 米及其他平台真机边界仍按前文保留。

### 20:54 收到重启确认后的补充复测

收到用户「CRM 已重启，继续验收」后，再次确认 CRM PID 19749、启动时间 20:33:48、健康状态 UP，与上一轮已验证的服务一致，未另行重启或重新编译。Redmi 登录和调试通道正常。

- 定位已可用、列表缓存已过期时：我的客户 1 条数据交付 908 ms；合作客户 0 条 807 ms；公海 20 条 1,255 ms。此处是页面加载逻辑计时，不是冷启动 GPS 或首帧渲染时间。
- 再切回公海命中 20 条缓存，赋值 9 ms；[约 0.3 秒开始采集的截图](../outputs/customer-nearby-20261113/restart-confirm-warm.png)已有完整名单，后台继续校验。
- [手动刷新中](../outputs/customer-nearby-20261113/restart-confirm-refreshing.png)保持当前列表；[刷新完成](../outputs/customer-nearby-20261113/restart-confirm-refreshed.png)时间更新至 20:54:29，附近页请求成功，数据交付 1,258 ms。
- [我的客户](../outputs/customer-nearby-20261113/restart-confirm-mine.png)、[合作客户空态](../outputs/customer-nearby-20261113/restart-confirm-cooperated.png)、[截图采集时间](../outputs/customer-nearby-20261113/restart-confirm-timing.json)已保存。没有新增业务写入，手机停留在公海。未验证边界与上一轮一致。

## 部署关系

以后后端部署到服务器后，App 使用服务器的 HTTPS Gateway 地址；IAM 登录地址、issuer、回调白名单等也须按同一环境配置。业务数据由后端访问服务器数据库，不需要在手机保存 17 万条门店。目前测试服务运行在电脑，但 DEV 数据库已经是独立数据库服务器，不能说当前所有数据都存在这台电脑上。

ADB reverse 仅用于现在的本地调试。正式服务器地址接通后，手机使用自己的网络直接访问服务器，不再依赖电脑转发。本次没有部署生产或变更生产环境地址。
