# AMS 2 Pro 只读遥测

核实日期：2026-11-06。以下源码链接指当时的 main/master，可能随固件和软件变更。当前目标打印机为 H2S 与 A1；未连接用户真机。

## 数据路径和身份

订阅 device/{printerSerial}/report。print.command=push_status 为状态；控制 ACK 不能覆盖传感器数据。按打印机、AMS 单元 id、料盘 id 缓存增量，缺失字段保留之前值。数组不是全量替换语义。每次连接成功订阅后请求一次 pushall 和一次 info.get_version；检测 AMS 重新出现时补查版本，不做高频全量轮询。

单元在 print.ams.ams[]；id 是十进制字符串。info 是十六进制字符串，使用 BigInt 解码并保留原值。低四位类型：1=原 AMS、2=AMS lite、3=N3F/AMS 2 Pro、4=N3S/AMS HT；未知值不猜。info.module[] 的 name 对应 ams/{id}、ams_f1/{id}、n3f/{id}、n3s/{id}；sn、sw_ver、hw_ver 属于该 AMS，不借用打印机序列号。两种型号来源冲突时保留冲突。

ams_exist_bits 是附件存在位，不是网络在线；网络状态另由 MQTT 连接决定。四槽单元的存在位为单元 id；HT id128..135 为 bit4+(id-128)。缺失存在位不会因增量没列出单元而把其删除。不能用 power_on_flag 推断在线。

## 环境和烘干

| 字段 | 含义 |
| --- | --- |
| temp | 摄氏度；缺失不是0 |
| humidity | 湿度等级；原始0保留为未定等级；不换算百分比 |
| humidity_raw | 0–100 %RH；负值或无效值为未知 |
| dry_time | 剩余分钟；0仍可能正在冷却 |
| dry_setting.dry_temperature | 当前设置的目标温度，可能不回报 |
| dry_setting.dry_duration | 设置时长，小时，负值无效 |
| dry_setting.dry_filament | 烘干材料设置 |

info bits4..7 为主状态：0关闭、1检查、2烘干、3冷却、4停止中、5异常、6加热失控无法停止、7产测、8..15未知。bits18..19 和20..21分别为两风扇，0关/1开/其余未知。bits22..23为子状态，0无、1加热阶段、2排湿阶段、3未知。官方当前只取两位；不能取四位而混入高位路由数据。

目标温度不来自 info 或材料的推荐 drying_temp。阶段是固件状态，不等同加热继电器/功率测量。AMS lite 的占位环境值不显示为真实传感器读数。这里只读取，不发送烘干命令。

## 当前进料和料盘

H2S 优先 print.device.extruder.info[].snow：unit=snow>>8、slot=snow&255，按挤出机 id 合并；存在未知路由时不推断进料。旧 print.ams.tray_now 为十进制：0..15=unit*4+slot、128..135=对应 HT 的槽0、254=外置料架、255=无进料。已知由其他单元供料不显示为“未上报”。

tray_exist_bits、tray_reading_bits、tray_read_done_bits、tray_is_bbl_bits 均按十六进制读取。四槽单元 bit=unit*4+slot；HT bit=16+(unit-128)+slot。存在位优先；余量0、空RFID或 state!=11 都不能独断空料盘。

料盘读取 tray_type、tray_sub_brands、tray_info_idx、tray_color（RRGGBBAA）、remain（0..100，-1未知）、tag_uid、tray_uuid。RFID 全零占位不证明无料：保留同一在位周期的上次有效身份，同时区分本轮观测与缓存。明确移除时清理材料/RFID/读取标志和活动槽。单元重新接入或序列号改变时重置旧单元遥测及对应路由，防止新设备继承旧数据。

## 验证与限制

- tests/ams.test.mjs 中 H2S 样例是 ha-bambulab 的 MOCK-H2S 固定样例裁剪，不是本次实机抓包。
- 含 dry_setting、多个单元、热插拔和高位掩码的测试是依据源码合成的报文，不冒充实机证据。
- 两个 MQTT 客户端的同号单元隔离通过内存替身测试；浏览器另验多单元、A1 无数据和未知值展示。
- 无 A1 新固件搭配 AMS 2 Pro 的本次实机报文；字段可用性随固件而变。缺失数据保持未知。
- 未实现多色 cols 的单卷渐变外观、外置料架完整材料详情或烘干控制。

## 来源

- 官方字段与掩码：[DevFilaSystem.cpp](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/DeviceCore/DevFilaSystem.cpp)、[DevFilaSystem.h](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/DeviceCore/DevFilaSystem.h)、[DevDefs.h](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/DeviceCore/DevDefs.h)
- 实装与 H2S 固定样例：[ha-bambulab models.py](https://github.com/greghesp/ha-bambulab/blob/main/custom_components/bambu_lab/pybambu/models.py)、[MOCK-H2S.json](https://github.com/greghesp/ha-bambulab/blob/main/custom_components/bambu_lab/pybambu/mock_data/MOCK-H2S.json)
- 增量及 RFID 缓存参考：[Bambuddy](https://github.com/maziggy/bambuddy/blob/main/backend/app/services/bambu_mqtt.py)、[OpenBambuAPI](https://github.com/Doridian/OpenBambuAPI/blob/main/mqtt.md)
- 产品与接法：[AMS 2 Pro](https://asia.store.bambulab.com/products/ams-2-pro)、[H2S FAQ](https://wiki.bambulab.com/en/h2/manual/h2s-faq)、[A1 AMS 连接指南](https://wiki.bambulab.com/en/a1/manual/ams-connection-guide)、[A1 固件与屏幕操作](https://wiki.bambulab.com/zh/a1/screen-operation)
