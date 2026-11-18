# 订单流转

排模、算料、报价和送货单使用同一份订单。运行时订单放在仓库外，或仓库里已忽略的 `private/`、`quotes/`、`outputs/`。客户名没有就空着，不从上一笔订单带入。

订单编号由使用人必填。尺寸、穴数、片材尺寸、材料、颜色、数量、厚度或克重、模具变更时，版本加一。旧计算和旧导出在订单档案里标为过期；排模仍然完整时用 `quote.cjs` 重算，并保留上一版来源。这条规则已经确认。`confirm-layout`、`recognize` 和 `update-spec` 走同一套逻辑：已确认排模发生变化，或识别结果撤回已确认排模时，都会递增版本、作废旧报价和旧导出、清掉正式确认，并在排模仍完整时重算。

## 闸门

尺寸、单位、穴数和片材尺寸先是待确认。缺单位、单位冲突、空的识别结果或标明看不清时，不调用报价。`ingestRecognition` 只接收调用方已经准备好的虚构或固定识别结果，不连接视觉服务，也不把密钥写进仓库。

人工确认后的片材长、宽和穴数一起传给 `quote.cjs`。三项缺一不可。传入后不再旋转、不再改穴数。没有这三项时，排版与原来的自动排版一致。材料费、加工费、小单费和取整仍只在 `quote.cjs` / `tray-engine.cjs` 里计算。

算料并排使用引擎已有的三个数：连续计价张数、排产整张数、小单张数。不良率不填当作 0，并写明未计损耗。不另造一套采购张数。

## 正式报价与出货

正式报价是订单上的另一次确认。有假设、缺参数、材料 `price_confirmed` 不是 true，或 `is_demo` 为 true 时，报价停在 `pending_review` 或 `blocked`。引擎为了算出参考价而把内部 `priceConfirmed` 写成 true，不算业务核准。仓库里的公开参考参数不能变成正式报价。

报价确认不写出货记录，也不把报价数量当成已交货。出货要单独记录本次数量和日期。余量 = 当前订单数量 − 已记录出货量。出货记录的 `delivery_confirmed` 保持 false，不自动确认发货。

未正式确认的报价仍可开送货单。这是已确认的做法，不要求先把报价标成正式确认才允许出货。送货单仍只使用本次出货数量和日期。

## 送货单

生成规则见 [送货单版式](delivery-note-format.md)。客户可见的 xlsx、PDF 和客户 JSON 只含本次出货需要给客户看的内容，不含材料单价、比重、成本、毛利或加工费档。

公开样例和仓库内测试使用 `templates/delivery-note-anonymized.xlsx`。正式范本留在仓库外，用 `deliver --profile official --template 仓库外路径` 或环境变量 `XISU_OFFICIAL_DELIVERY_TEMPLATE` 指定。正式输出不写入「示例送货单」或「虚构送货单」这类样例标题。不要把正式范本复制进仓库。

虚构端到端样例在 `examples/fictional-e2e/`。样例订单号 `DEMO-E2E-001`，客户「示例客户」，确认片材 90 × 60 cm、6 穴；公开参考价保持待复核。两批出货分别是 2026-03-03 的 400 个和 2026-03-18 的 600 个。

```text
node skills/xisu-quotation/scripts/order-flow.cjs init --order-no DEMO-E2E-001 --customer 示例客户 --product 示例吸塑产品
node skills/xisu-quotation/scripts/order-flow.cjs show --order-no DEMO-E2E-001
```

在仓库根目录执行。不写 `--dir` 时，订单写到仓库内已忽略的 `private/orders`。不能把订单写到仓库根目录。命令有 `init`、`recognize`、`confirm-layout`、`update-spec`、`quote`、`confirm-formal`、`ship`、`deliver`、`show`。
