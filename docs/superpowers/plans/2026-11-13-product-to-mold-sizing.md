# 产品尺寸设计 Implementation Plan

> **For agentic workers:** 按下列独立任务实施并复核实际结果。

**Goal:** 为已有报价Skill增加可复算的产品到吸塑/模具参考尺寸设计。

**Architecture:** 新增纯函数尺寸模块和独立页面；原费用/排版程序继续接收吸塑外形。缺少工艺参数时返回缺项，不用估厚补模具尺寸。

**Tech Stack:** 原生Node.js CommonJS、现有HTTP服务器、HTML/CSS/JS，无新增运行依赖。

**Spec:** ../specs/2026-11-13-product-to-mold-sizing-design.md

## Global Constraints

- Node.js18+；既有报价公式和含税系数1.1保持原口径。
- 所有新增设计输出只能pending_review或blocked；tooling_release始终false。
- 工程输入mm，报价cm；产品、吸塑、模具三者不得混用。
- 不部署网站，不改线上客户记录；以独立分支交付可审查更新。

## Review Focus

- 空值和无效值分开，0收缩/0间隙有效，布尔值不得进入算式。
- 圆形单位与直径口径正确，重复width冲突不静默忽略。
- 缺成型有效偏置或收缩时不得输出伪造的模具加工数值。
- 深度/覆层/壁厚改变特征基准，不能把原片厚直接平加到所有尺寸。
- 设计改变后旧结果不能带入报价，原有报价输入改动不能保留旧设计归属。

## Task 1: 确定性尺寸计算

Files: scripts/design-tray.cjs，scripts/design-tray.test.cjs（均在skills/xisu-quotation下）。

- [x] 写独立手算和输入异常测试，运行确认缺少实现时失败。
- [x] 按Spec实现designTray及CLI，所有采用值注明来源。
- [x] 验证默认矩形100×60×20mm的净底102×62、净口约104.096311×64.096311、裁切120.096311×80.096311；报价向上到120.10×80.10mm。
- [x] 覆盖阴阳模、覆层、基准偏置与各向收缩；原报价核心回归通过，浏览器部分受环境阻碍。

## Task 2: 本机入口与交接

Files: web/design.html、web/design.js、web/styles.css、web/index.html、web/app.js、scripts/web-server.cjs与新HTTP/浏览器测试。

- [x] 添加实际HTTP和用户流程测试；HTTP先观察404失败再通过，浏览器用例尚待运行。
- [x] 暴露经过现有认证/来源校验的POST /api/design，增加独立页面与原页入口。
- [x] 显示假设/缺项/分层尺寸并实现明确确认后的报价交接；防止陈旧结果。
- [ ] 浏览器验证桌面与窄屏、cm/mm换算、产品尺寸未直接进入价格、手改关联清除。

## Task 3: Skill与交付

Files: SKILL.md、references/design-rules.md、assets/design.example.json、README.md、package.json。

- [x] 更新触发与工作流，补充参数解释、公式、实际命令和工程参考来源。
- [x] 新增完整示例并运行，检验未确认参数不会变成正式加工指令。
- [ ] 独立复核、全部回归和浏览器验收；记录真实结果。
- [ ] 保存独立GitHub分支与草稿PR，核对远端文件及基线。

## 实际验收记录

见 [验收记录](../../PRODUCT-SIZING-VERIFICATION.md)。核心与HTTP通过；浏览器验收尚未完成，不把完整npm test记为通过。
