# 普通片材工位机报价

用于普通未植绒片材成品。按本单实测克重、拉片、产能和价格填写，适用于估算整单保本价和对客报价。

| 输入 | 字段与单位 |
|---|---|
| 投料依据 | `mode` 填 `weight`（克重与成品率，默认），或 `sheet`（实际拉片） |
| 数量与模穴 | `quantity` 订单件数，`cavities` 每模成品件数 |
| 克重模式 | `pieceWeight` 成品单件克重 g，`yieldPercent` 成品率百分数，例如 80% 填 80 |
| 拉片尺寸来源 | `sheetSource` 填 `actual`（直接填写，默认）或 `layout`（按单件尺寸排模） |
| 已知实际拉片 | `sheetLengthMm` 拉片长 mm，`sheetWidthMm` 拉片宽 mm |
| 根据产品排模 | `productLengthMm`、`productWidthMm` 为单件外部长宽 mm。填 `gapMm` 件间净距和 `edgeMm` 模具每边留量，单位 mm |
| 排模方式 | `layoutMethod` 填 `manual` 时填 `layoutAlongLength`、`layoutAlongWidth`；填 `auto` 时填 `maxMoldLengthMm`、`maxMoldWidthMm`，可用 `preferredMoldLengthMm` 给常规版设更短的长度上限。允许整体旋转 90° 时，`layoutOrientation` 可填 `compare` |
| 片材参数 | `thicknessMm` 原片厚度 mm，`density` 原片比重 g/cm³ |
| 拉片模式的成品率 | `yieldBasis` 填 `measured`（实测克重，输入 `pieceWeight`）、`projection`（单件裁切投影面积，输入 `pieceAreaCm2`，单位 cm²）或 `provided`（直接输入 `yieldPercent`） |
| 有效产能 | `cycleSeconds` 秒/模，`shiftHours` 每班有效工时 |
| 材料与生产费 | `materialPrice` 原料元/kg，`scrapPrice` 废料回收元/kg，`shiftCost` 每班生产费用元/班。无回收收入填 0 |
| 班费 | `shiftBilling` 填 `prorated`（按工时分摊，默认）或 `whole`（不足一班按整班） |
| 包装与其他费用 | `boxCapacity` 件/箱和 `boxPrice` 元/箱成对填写。另可填 `loadingCost` 装运费、`moldCost` 模具费和 `otherCost` 其他费用，单位元/单 |
| 税点与加价 | `taxPercent` 税点百分数，未税填 0。`targetProfit` 可选填整单目标加价（未税元），留空按保本核算 |

价格和成品率由使用者提供。模具或产品的实际成品率不同，应按相应试模数据填写。投影面积按切下后留在成品上的面积，可包含保留的口沿。

每个方向上的模具尺寸为「本方向件数 × 产品尺寸 ＋（件数 − 1）× 件间净距 ＋ 两边留量」。由排模得到的拉片长等于模具长，拉片宽等于模具宽加 40 mm。自动排模在设备和常规版上限内取最多穴数，同穴数时优先取模具面积较小的方向。推算尺寸供报价估算，已知实测拉片时可直接填写长宽。

克重模式用成品总重量除以成品率求投料。拉片模式按实排片材面积、原片厚度和比重求每模投料；成品率可由成品克重、裁切投影或本单实测值确定。装箱数向上取整。整单费用包含材料净成本、班费以及本单填入的实际费用。材料净成本是原料支出扣除废料回收。单价按元/件向上取 4 位小数，整单金额按该单价乘数量。装运费留空时，报价未计装运费。

在技能目录运行 `node scripts/station-quote.cjs 订单.json`，也可用 `-` 从标准输入传入 JSON。只核算模具与拉片尺寸时可运行 `node scripts/station-quote.cjs --layout 排模.json`。网页可从本机报价台首页顶部进入。聊天、命令行与本机网页使用同一工位机计算程序。
