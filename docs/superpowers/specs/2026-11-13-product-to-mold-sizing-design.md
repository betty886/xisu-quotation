# 产品尺寸 → 吸塑尺寸与模具参考尺寸

## 目的与范围

用户要求在现有 xisu-quotation 报价 Skill 上增加尺寸设计：客户只有被包装产品时，可按其尺寸推导吸塑尺寸并继续报价。实现独立的确定性计算模块、可操作的本机设计入口和报价衔接。规则矩形与圆柱、单腔、放入式配合是首版的实现选择，不把这项选择写成用户已经核准的工厂规则。

尺寸层次：产品包络 → 使用净腔底 → 使用净开口 → 裁切外形 → 模具接触特征 → 收缩补偿后的单穴模具参考尺寸。所有工程长度统一 mm；原报价输入仍为 cm。

首版不生成可直接加工的 CAD/CAM、铝坯尺寸、冷却水路、夹持结构、异形卡位、扣位、圆角或多件异形组合。始终 `tooling_release: false`，由实物/CAD与试模确认后另行工程放行。

## 方案取舍

- 仅写提示词：无法保证尺寸与单位可复算，放弃。
- 独立尺寸计算器接现有报价（采用）：复用现有费用与排版引擎，新增公式和缺项管理；可以核验每个数值。
- 直接自动建模及CAM：本请求未提供产品曲面、机台和结构条件，作为后续能力。

## 计算口径

预估参数为软件起点，不是行业规范或用户核准值：每侧间隙1mm、拔模3°、完成后净口到裁切线8mm。默认净腔深度等于产品高，可改为较浅深度并列出产品露出量。

`B = Pmax + 2c + e`，其中 e 为整条底部尺寸的成型负公差补偿（不是每侧）。`O = B + 2H tan(alpha)`；`T = O + 2F`。圆形用直径同式。各式按理想尖角和直壁包络，圆角占空间必须另核实。报价长宽使用裁切尺寸向上保留0.01mm再转cm。报价高度默认用净腔深度做初步估计，单独标注，可提供实际成型外高覆盖。边料/排版出血仍由原报价引擎按已定规则单独计算，不从本设计边宽再拆减或重复写入出血。

模具接触特征必须有明确阴/阳模。无覆层时内表面目标等于使用净腔。植绒/植布时需底部、开口的对应特征单侧有效偏置与净深差；缺失为未知，不是0。阳模采用塑料内表面；阴模另需底、口对应特征有效单侧偏置及深度差。此偏置来自实测或CAD，不等于原片厚或任意同高度水平截面壁厚。重算接触面斜度，阻止倒扣或非正深度。

收缩定义 `s=(模具参考温度尺寸-最终稳定接触特征尺寸)/模具参考温度尺寸`，则 `M=D/(1-s)`。支持统一系数或length/width/height三方向系数，不按材料名称猜收缩。缺少收缩或必要偏置时模具尺寸为空，保留概念设计。全部数值齐全仍为工程参考，绝不自动放行加工。

## 核心接口约定

`scripts/design-tray.cjs` 导出 `designTray(input)`；命令行 `node scripts/design-tray.cjs 输入.json` 输出JSON，blocked退出2。

输入：

```json
{
  "product": {"shape":"rectangle","unit":"mm","length":100,"width":60,"height":20,"dimensions_are_maximum":true,"source":"客户测量"},
  "design": {"clearance_per_side_mm":1,"draft_angle_deg":3,"rim_to_trim_mm":8,"pocket_depth_mm":20,"forming_negative_tolerance_mm":0,"quote_height_mm":20},
  "lining": {"type":"none"},
  "tooling": {"mold_type":"male","shrinkage_fraction":0.005,"source":"仅示例，非工厂实测"},
  "fit_mode":"loose"
}
```

design各字段可缺省；默认及未确认值逐项追踪。`forming_negative_tolerance_mm`缺失可用0试算但明确未核准。product单位必填；尺寸为正；shape只rectangle/circle，圆形length为直径，若同时填写width须与直径一致。未知单位/无效值/不支持形状或卡紧结构blocked。数值可为严格十进制字符串，不能把布尔值、数组、空对象变成数字。

lining.type为none/flock/cloth；覆层需 `bottom_offset_mm`、`opening_offset_mm`、`depth_offset_mm`（均有符号、对应特征有效补偿）和source。阴模 tooling 需同名三个offset字段。收缩参数可为一个小数或对象 `{"length":0.005,"width":0.004,"height":0.003}`；0是有效显式值，未提供不能变0。

返回：`schema_version,status,tooling_release,errors,warnings,assumptions,pending_review,input,parameters,geometry,tooling,quote_dimensions`。

- errors/warnings/assumptions/pending_review均为字符串数组，input原样保留，不修改调用方。
- geometry有 `product_mm:{length,width,height}`、`cavity_bottom_mm:{length,width}`、`cavity_opening_mm:{length,width}`、`pocket_depth_mm`、`protrusion_mm`、`trim_outer_mm:{length,width}`、`quote_height_mm`。
- tooling有 `status:needs_parameters|reference_only`、`mold_type`、`contact_mm`、`mold_mm`、`missing`。contact_mm与mold_mm形如 `{bottom:{length,width},opening:{length,width},depth}`，不可算时null；接触面斜度可加到tooling内。
- quote_dimensions为 `{shape,length_cm,width_cm,height_cm}`，仅设计无错误时有值。仍为初步设计，调用方须明确接受后才带入；不能替换同订单已有冲突尺寸。圆形width_cm与length_cm相等，原报价引擎按圆面积处理。

## 界面与报价衔接

新增独立 /design 页面及当前工作台内的“只有产品？先设计吸塑尺寸”入口。设计不要求先填数量或材料价格。显示产品、净腔底、净开口、深度/露出、裁切外形、模具参考值与缺项；高级项允许工厂输入阴阳模、收缩及有效偏置。默认参考假设可见。

同源POST /api/design调用designTray，复用现有认证/Host/Origin限制。尺寸结果需用户勾选“按本方案做初步报价”后按“带入报价”，填写原界面的外形尺寸与所选模具。跨页面传递请求和结果来源，主界面明确标注“按产品推算，待样品确认”。设计输入改变立即禁用旧结果交接；主界面尺寸或模具手改后清除旧设计关联。原片厚字段不能被当成成型偏置。

## 验收与边界

手算矩形/圆形、cm/mm等价、可露出高度、默认来源、0间隙及0收缩、负数/布尔/超大数/单位错误、阴模缺偏置、植绒缺偏置、接触面倒扣、各向收缩、CLI退出码、无副作用；HTTP认证及输入错误；浏览器设计→确认→报价、变更输入撤销旧结果、两种单位和窄屏。运行全部原报价回归，特别含税1.1和已有植绒规则。

待业务确认：常见产品装入方式、各材料/机台间隙和斜度、正常露出量、口沿宽度、产品与成型/裁切公差、按材料/机台/方向记录的实际收缩与对应尺寸偏置。未确认项不阻止编写可审查功能，但不作已核准工艺使用。
