# 吸塑报价 Skill

根据产品尺寸、材质、颜色、模具和数量，计算吸塑产品的排版与参考报价。包含本地报价界面、可执行的 Node.js 算价脚本和参考配置；安装后可直接使用，也可以把材料单价、比重和收费参数改成本厂的数值。

支持普通 PVC、PS、PET、PET 透明、PP、触感 PET、镀金 PET，以及配套成品参数的植绒材料和按面积计价的植布。完整材料与颜色组合见 [参考参数](skills/xisu-quotation/assets/parameters.reference.json)。

## 安装

在 Codex 中发送：

```text
使用 $skill-installer，从 GitHub 仓库 betty886/xisu-quotation 安装 skills/xisu-quotation。
```

或将 `skills/xisu-quotation` 整个文件夹复制到项目的 `.agents/skills/`。保留 `SKILL.md`、`web/`、`scripts/`、`assets/` 和 `references/`。安装后若未显示，重启助手。已有安装请更新整个技能文件夹，先备份自己修改过的参数。

## 使用

### 打开报价界面

先安装 Node.js 18 或更新版本。报价台只供内部使用，启动前要设置环境变量 `QUOTE_PASSWORD`。这个口令从环境变量或部署密钥读取，不要写进代码、不要提交到仓库。可参考仓库根目录的 `.env.example`。

```text
export QUOTE_PASSWORD='换成你自己的口令'
```

Windows 可先在同一窗口执行 `set QUOTE_PASSWORD=换成你自己的口令`，再双击技能目录中的 `启动报价台.cmd`。其他系统在技能目录执行：

```text
QUOTE_PASSWORD='换成你自己的口令' node scripts/web-server.cjs --open
```

未设置口令时服务会拒绝启动。打开页面后先输入该口令，通过后才能填写规格。程序仅在本机运行，不需要连接官网；若浏览器没有自动打开，访问终端显示的本机地址。界面与聊天报价使用同一套材料参数和计算程序。手机尺寸适配可在浏览器模拟；本机服务默认不对其他设备开放。

不选模具时，普通及植绒材料按阳模、植布按阴模做初步报价，并显示「初步报价、待复核」。

普通材料可填写厚度或单件净重，也可按高度估算；植绒填写裸基材厚度，暂不支持仅用植绒净重反推。估算和内置材料价格需核对后用于实际订单。

### 聊天报价


在支持 Skill 的 AI 助手中描述订单，例如：

```text
使用 $xisu-quotation，按 PET透明、透明，长7.2厘米、宽7.7厘米、高3.6厘米，阳模，厚0.8毫米，数量24万个，计算未税和含税参考报价。使用内置参数，并列出排版和费用。
```

也可以安装 Node.js，在技能目录中运行：

```text
node scripts/quote.cjs 订单.json
```

可直接运行自带示例：

```text
node scripts/quote.cjs scripts/order.sample.json
```

该示例为 PET 透明、阳模、0.8 mm、24 万件，预期未税单价 0.1305 元/件、含税单价 0.1410 元/件，状态 `pending_review`。命令默认读取技能目录下的 `assets/parameters.reference.json`。如需使用自己的参数文件，复制参考配置后修改，再指定文件路径：

```text
node scripts/quote.cjs 订单.json 自己的参数.json
```

界面也可使用同一个自有配置：`node scripts/web-server.cjs --open --config 自己的参数.json`。关闭后重新启动可切换配置；仅修改本地配置，不会同步到其他设备。

订单采用 JSON 格式，字段和单位可参考 [订单示例](skills/xisu-quotation/assets/order.example.json)：尺寸使用厘米、厚度使用毫米、数量使用件；实际材料和颜色需与所用参数表一致。输出包含未税和含税单价、整单金额、排版及状态。示例配置和订单仅供教学，不应与默认参考配置混用。

## 内置参考配置

参考配置提供材料和颜色对应的未税单价、比重、机器规格、加工费、小单费和 **1.08 含税系数**。植布参考价为 **16 元/平方米**、加工费为 **3 元/张**。这些数字供下载后直接试算，使用者可改成自己的实际参数；采购价格及设备条件变化时应先核对。

植绒材料单价和比重可在参考参数表中查看或修改。

机器默认最大 126 × 76 cm，长宽每方向两端边料合计各 4 cm；阴模长宽各总加 1 cm。普通及植绒按两方向比较排版；植布固定方向，整张长不超过 110 cm、宽不超过 70 cm，包含边料和出血，不允许旋转。

普通及植绒加工费按各材料基础加工费加穴数档差；小单张数为订单数量 ÷ 每张穴数，不取整：不足 500 张收 500 元，500 至不足 1000 张收 300 元，1000 张及以上不收。模具费、包装费及运费按订单输入分别计入。

尺寸、厚度或克重、模具类型等信息影响结果。缺模具或使用高度估厚等假设时，结果标为 `pending_review`；缺关键参数或输入无效则为 `blocked`。请核对实际材料、颜色、模具与订单条件后再对客户报价。

## 文件说明

- `skills/xisu-quotation/SKILL.md`：AI 助手的报价流程。
- `skills/xisu-quotation/scripts/quote.cjs`：独立算价入口。
- `skills/xisu-quotation/scripts/web-server.cjs` 和 `web/`：本机报价界面。
- `skills/xisu-quotation/assets/parameters.reference.json`：材料、颜色、机器和收费的可修改参考参数。
- `skills/xisu-quotation/assets/order.example.json`：订单输入字段及单位示例。
- `skills/xisu-quotation/references/`：通用计算规则、植布规则与教学算例。

客户信息和本厂私有价格建议放在仓库外，或保存到 `private/`、`*.local.json`。内置参考值不等同于实时市场价格。
