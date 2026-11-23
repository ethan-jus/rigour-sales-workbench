# 我的 V1 与外勤轨迹实现

2026-11-17。根据已确认的 `design-system/rigour-sales-workbench/pages/profile-v1/` 实施。

## 页面与职责

- 我的：姓名/公司资料、外勤记录、声音登记、材料同步、使用帮助；右上角设置。仅存在待同步材料时显示提醒。
- 设置/个人资料/关于：复用原 `work` 路由，删除业绩、提成、消息等占位分支和员工诊断入口。资料只展示现有账号与员工档案字段，保留身份识别重试；版本读取实际安装信息。
- 声音登记：已登记/未登记 → 主动同意 → 录制 → 确认；保留原录音及 revision 合同，删除确认、失败保留与取消。没有重写声音采集服务。
- 材料同步：展示当前账号聚合队列状态、重试、帮助；不显示不存在的百分比。同步完成与业务提交/有效性分别解释。
- 使用帮助：有效拜访、同步、声音登记、个人资料四篇；规则门槛引用本次拜访适用规则，不另写独立10分钟判断。应用权限页说明用途并跳转系统设置，不伪造授权状态。
- 外勤核查：保留查询、原因选择、说明提交与历史合同；已提交后先查看历史，可继续补充。说明提交不等于核查通过。

## 当日轨迹

1. 按真实时间戳排序；签到、签退、缺失时段不占拜访编号。缺坐标的拜访保留编号，并中断顺序连线。
2. 签到为绿色 GO，签退为红色 END，拜访为橙色序号。相同坐标的拜访合并为序号范围，重复点击图钉或使用前后切换查看每次拜访；不移动真实位置。
3. “拜访顺序”用橙色虚线连接事件位置，明确说明仅表示顺序，不表示实际道路或计入里程。“实际轨迹”只展示服务端可靠连续分段，缺失时段不补线。
4. 普通地图/全屏共用同一天数据；系统返回优先退出全屏。详情卡和时间线展示门店、起止时间、服务端停留时长、地址，并进入既有拜访详情。
5. 拜访地址来自 `TrackVisitView.storeAddress` 发生时快照。签到地址通过新增本人工作日 `GET /sales/me/work-days/{date}/punch-addresses` 独立加载，返回原打点索引 key；沿用本人轨迹权限及租户/销售身份校验。
6. Sales 调用 Integration 的 GCJ02 逆地理编码分支，不重复转换已经标准化的坐标。Integration 缓存键包含坐标系。地址失败不阻断轨迹，也不借用门店地址；账号或日期改变时丢弃旧回执。
7. UTS 原生对象的地址回填后更换 `FieldTrack` 引用，确保界面刷新；有针对性回归覆盖。

## 验证依据

- `scripts/test-app-fieldwork.cjs`：时区排序、序号、缺位置、同址合并、缺失分段、原生地址刷新、旧账号回执失效、全屏返回等。
- Android 使用 Redmi M2007J22C / Android 12 / `com.rigour.workbench` 自定义基座；本目录 QA 截图来自实际 DEV 数据，不是原型。
- 后端：`SalesTrackAddressServiceTest`、`SalesWorkReopenAndTrackIntegrationTests`、`AmapReverseGeocoderTest`、`AmapControllerTest` 共18项通过；包括 MySQL Testcontainers 轨迹集成测试。
- 设备与编译最终记录见 `docs/qa/profile-v1-20261117/验证记录.md`。
- `capture.uts`、`crm-media.uts` 与本轮开始时 SHA256 一致，拍照与录音采集修复保留。

## 官方 API 依据

- [系统权限页跳转](https://doc.dcloud.net.cn/uni-app-x/api/open-app-authorize-setting.html)：已验证 Redmi 系统应用信息页跳转，未修改手机权限。
- [应用版本](https://doc.dcloud.net.cn/uni-app-x/api/get-app-base-info.html)：使用 appVersion，Redmi 显示0.2.1，与系统应用信息一致。
- [UTSJSONObject.keys](https://doc.dcloud.net.cn/uni-app-x/uts/buildin-object-api/utsjsonobject.html)：共享工作区同时增加的企微模块使用 Object.keys 导致 Android 编译失败，仅将该调用改为 UTS 官方 API；企微业务逻辑保留。新企微页面注册移到页面列表末尾，保留登录页作为启动入口。

本轮仅本地/DEV联调，无生产发布、无数据库迁移、无 commit/push。Sales/Integration 重启由用户在 IDEA 操作并确认。
