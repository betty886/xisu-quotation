'use strict';
// 成品吸塑计算，仅使用由调用方传入的公开参数。
const defaultRules={processingTiers:[]};
  const blank = value => value == null || (typeof value === 'string' && value.trim() === '');
  const asNumber = value => {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return NaN;
    return Number(value.trim());
  };
  function number(object, key, label, messages, options = {}) {
    const value = object[key];
    if (blank(value)) {
      if (Object.prototype.hasOwnProperty.call(options, 'fallback')) return options.fallback;
      if (options.optional) return null;
      messages.push(`请填写${label}。`);
      return null;
    }
    const n = asNumber(value);
    if (!Number.isFinite(n) || (options.integer && !Number.isSafeInteger(n))) {
      messages.push(`${label}必须是${options.integer ? '有效整数' : '有效数字'}。`);
      return null;
    }
    if ((options.min != null && n < options.min) || (options.positive && n <= 0) || (options.max != null && n > options.max) || (options.maxExclusive != null && n >= options.maxExclusive)) {
      messages.push(`${label}超出允许范围${options.positive ? '（必须大于 0）' : options.maxExclusive != null ? `（不得小于 ${options.min ?? 0}，且必须小于 ${options.maxExclusive}）` : options.max != null ? `（${options.min ?? 0}～${options.max}）` : '（不得小于 0）'}。`);
      return null;
    }
    return n;
  }
  const fresh = () => ({errors:[],warnings:[],blockers:[],canQuote:false,costTotal:null,costUnit:null,suggestedUnit:null,floorUnit:null,finalUnit:null,total:null,margin:null,breakdown:[],quantity:null,unit:null,taxFactor:null,floorGapUnit:null,floorGapTotal:null});
  const up4 = n => Math.ceil(n * 10000 - Math.min(1e-8, Math.abs(n * 10000) * Number.EPSILON * 2)) / 10000;
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const confirmed = (record,label,result) => {
    if (!record || record.status !== '已确认') result.errors.push(`${label}未确认，请检查规则主档。`);
  };
  function fixedFees(input, keys, result) {
    return keys.map(([key,label]) => ({key,label,amount:number(input,key,label,result.errors,{min:0,fallback:0})}));
  }
  function finiteResult(result) {
    let invalid = false;
    function visit(o) {
      for (const key of Object.keys(o)) {
        const value=o[key];
        if (typeof value === 'number' && !Number.isFinite(value)) { o[key]=null; invalid=true; }
        else if (value && typeof value === 'object') visit(value);
      }
    }
    visit(result);
    if (invalid) {
      result.errors.push('输入数值过大或过小，计算超过有效范围，请调整后重试。');
      for (const key of ['costTotal','costUnit','suggestedUnit','floorUnit','finalUnit','total','margin']) result[key]=null;
    }
    result.canQuote = result.errors.length === 0 && result.blockers.length === 0 && result.finalUnit !== null && result.total !== null;
    return result;
  }
  function finishPricing(result,input,taxFactor,passthroughTotal=0) {
    const b=result.blockers;
    if (input.taxIncluded != null && typeof input.taxIncluded !== 'boolean') b.push('是否含税必须明确选择。');
    result.taxFactor=taxFactor;
    const target=number(input,'targetMargin','目标毛利率',b,{min:0,maxExclusive:100});
    const minimum=number(input,'minMargin','最低毛利率',b,{min:0,maxExclusive:100});
    result.targetMargin=target;
    result.minMargin=minimum;
    if (target !== null && minimum !== null && target < minimum) b.push('目标毛利率不得低于最低毛利率。');
    if (target === 0 || minimum === 0) result.warnings.push('毛利率为 0 的对应价格是成本价，不含利润。');
    if (input.priceConfirmed !== true) b.push('请核实本单原料价格、加工参数及报价条件，再确认可对客报价。');
    const manual=number(input,'manualUnit','手填最终单价',b,{min:0,optional:true});
    result.manualUnit=manual;
    if (result.errors.length || result.costTotal === null || taxFactor === null) return finiteResult(result);
    result.costUnit=result.costTotal/result.quantity;
    result.passthroughTotal=passthroughTotal;
    result.pricedCostTotal=result.costTotal-passthroughTotal;
    result.taxCostUnit=(result.pricedCostTotal*taxFactor+passthroughTotal)/result.quantity;
    if (!Number.isFinite(result.costTotal) || !Number.isFinite(result.costUnit) || !Number.isFinite(result.taxCostUnit)) return finiteResult(result);
    if (target !== null) result.suggestedUnit=up4((result.pricedCostTotal*taxFactor/(1-target/100)+passthroughTotal)/result.quantity);
    if (minimum !== null) result.floorUnit=up4((result.pricedCostTotal*taxFactor/(1-minimum/100)+passthroughTotal)/result.quantity);
    result.finalUnit=manual !== null ? up4(manual) : blank(input.manualUnit) ? result.suggestedUnit : null;
    if (result.finalUnit !== null) {
      result.total=round2(result.finalUnit*result.quantity);
      const untaxedRevenue=(result.total-passthroughTotal)/taxFactor;
      result.margin=untaxedRevenue>0 ? (untaxedRevenue-result.pricedCostTotal)/untaxedRevenue*100 : null;
      if (result.total <= 0) b.push('订单总额必须大于 0 才能正式报价。');
      if (result.floorUnit !== null && result.finalUnit < result.floorUnit) {
        result.floorGapUnit=up4(result.floorUnit-result.finalUnit);
        result.floorGapTotal=round2(result.floorGapUnit*result.quantity);
        b.push(`最终单价低于最低报价 ${result.floorGapUnit.toFixed(4)} 元/单位，整单差额 ${result.floorGapTotal.toFixed(2)} 元；请提高报价。`);
      } else {
        result.floorGapUnit=0;
        result.floorGapTotal=0;
      }
      // The payable total is rounded to cents. It must still cover the margin floor.
      if (minimum !== null && result.total > 0 && result.margin !== null && result.margin+1e-9 < minimum && !b.some(s=>s.startsWith('最终单价低于'))) {
        b.push('订单总额取整后低于最低毛利要求，请提高最终单价。');
      }
      if (result.total > Number.MAX_SAFE_INTEGER / 100 || result.finalUnit > Number.MAX_SAFE_INTEGER / 10000) {
        b.push('报价金额超出可靠金额精度范围，请调整输入。');
        result.finalUnit=null;result.total=null;result.margin=null;
      }
    }
    return finiteResult(result);
  }
  function candidate(length,width,allowance,settings,rotated) {
    const x=(rotated?width:length)+allowance;
    const y=(rotated?length:width)+allowance;
    const {maxLengthCm,maxWidthCm,edgeCm,gapCm}=settings;
    const columns=Math.max(0,Math.floor((maxLengthCm-edgeCm+gapCm)/(x+gapCm)+1e-12));
    const rows=Math.max(0,Math.floor((maxWidthCm-edgeCm+gapCm)/(y+gapCm)+1e-12));
    const sheetLengthCm=columns ? columns*x+(columns-1)*gapCm+edgeCm : 0;
    const sheetWidthCm=rows ? rows*y+(rows-1)*gapCm+edgeCm : 0;
    return {direction:rotated?'B':'A',orientation:rotated?'旋转90°':'原方向',columns,rows,cavities:columns*rows,sheetLengthCm,sheetWidthCm,occupiedLengthCm:x,occupiedWidthCm:y,areaCm2:sheetLengthCm*sheetWidthCm,edgeCm,gapCm};
  }
  const shapeLabels={rectangle:'长方形 / 正方形',circle:'圆形',ellipse:'椭圆形',hexagon:'正六边形',triangle:'三角形',custom:'自定义异形'};
  function productGeometry(input,length,width,errors) {
    const shape=blank(input.shape)?'rectangle':input.shape;
    if (!Object.prototype.hasOwnProperty.call(shapeLabels,shape)) {
      errors.push('请选择有效的产品形状。');
      return {shape,shapeLabel:'未知形状',areaCm2:null,layoutLengthCm:length,layoutWidthCm:width};
    }
    let areaCm2,layoutLengthCm=length,layoutWidthCm=width;
    if (shape==='rectangle') areaCm2=length*width;
    else if (shape==='circle') {areaCm2=Math.PI*length*length/4;layoutWidthCm=length;}
    else if (shape==='ellipse') areaCm2=Math.PI*length*width/4;
    else if (shape==='hexagon') {areaCm2=3*Math.sqrt(3)*length*length/8;layoutWidthCm=Math.sqrt(3)*length/2;}
    else if (shape==='triangle') areaCm2=length*width/2;
    else areaCm2=number(input,'customAreaCm2','异形实际投影面积（cm²）',errors,{positive:true});
    if (!(Number.isFinite(areaCm2)&&areaCm2>0)) errors.push('产品形状面积必须大于0。');
    return {shape,shapeLabel:shapeLabels[shape],areaCm2,layoutLengthCm,layoutWidthCm};
  }
  function processingTierForCavities(cavities,tiers=defaultRules.processingTiers) {
    if (!Number.isSafeInteger(cavities) || cavities < 1 || !Array.isArray(tiers)) return null;
    const matches=tiers.filter(t=>t && t.status==='已确认' && Number.isSafeInteger(t.min) && Number.isSafeInteger(t.max) && t.min<=cavities && cavities<=t.max && Number.isFinite(t.fee) && t.fee>=0);
    if (matches.length!==1) return null;
    const tier=matches[0];
    return {min:tier.min,max:tier.max,fee:tier.fee,label:`${tier.min}–${tier.max}个`};
  }
  function processingFeeForMaterial(cavities,material,tiers=defaultRules.processingTiers) {
    const tier=processingTierForCavities(cavities,tiers),baseTier=processingTierForCavities(1,tiers);
    const baseFee=Number(material?.processingPerSheet);
    if (!tier || !baseTier || !Number.isFinite(baseFee) || baseFee<0) return null;
    const increment=tier.fee-baseTier.fee;
    if (!Number.isFinite(increment) || increment<0) return null;
    const effectiveFee=Math.round((baseFee+increment)*1e10)/1e10;
    return {...tier,referenceFee:tier.fee,referenceBaseFee:baseTier.fee,baseFee,increment,effectiveFee};
  }
  function processingMultiplier(cavities,tiers=defaultRules.processingTiers) {
    const tier=processingTierForCavities(cavities,tiers);
    return tier ? tier.fee/defaultRules.processingTiers[0].fee : null;
  }
  function calculateTray(input={},rules=defaultRules) {
    const r=fresh();r.unit='件';
    if (!input || typeof input !== 'object' || Array.isArray(input)) {r.errors.push('报价输入格式无效。');return r;}
    if (!rules || !Array.isArray(rules.materials) || !Array.isArray(rules.prices) || !Array.isArray(rules.quantityRules) || !rules.layout || !rules.freight) {r.errors.push('报价规则结构不完整。');return r;}
    const e=r.errors;
    const length=number(input,'lengthCm','产品长度（cm）',e,{positive:true});
    const requestedShape=blank(input.shape)?'rectangle':input.shape;
    const width=number(input,'widthCm','产品宽度（cm）',e,{positive:true,optional:['circle','hexagon'].includes(requestedShape)});
    const height=number(input,'heightCm','产品高度（cm）',e,{min:0});
    const moldType=blank(input.moldType)?'male':input.moldType;
    if (!['male','female'].includes(moldType)) e.push('请选择有效的模具类型。');
    const bleed=moldType==='female'?number(input,'bleedCm','阴模排版总出血位（cm）',e,{min:0}):null;
    r.moldType=moldType;
    r.layoutAllowanceSource=moldType==='female'?'bleed':'height';
    r.layoutAllowanceCm=moldType==='female'?bleed:height;
    const quantity=number(input,'quantity','订单数量（件）',e,{positive:true,integer:true});
    const reject=number(input,'rejectRate','额外不良率（%）',e,{min:0,max:99,fallback:0});
    const areaPriced=input.material==='植布';
    const rawThickness=input.thicknessMm;
    const zeroThickness=rawThickness===0||(typeof rawThickness==='string'&&rawThickness.trim()!==''&&asNumber(rawThickness)===0);
    const thickness=areaPriced?null:number(zeroThickness?{...input,thicknessMm:''}:input,'thicknessMm','实测原片厚度（mm）',e,{positive:true,optional:true});
    const weight=areaPriced?null:number(input,'weightG','产品克重（g/件）',e,{positive:true,optional:thickness!==null});
    const geometry=productGeometry(input,length,width,e);
    r.shape=geometry.shape;r.shapeLabel=geometry.shapeLabel;r.productAreaCm2=geometry.areaCm2;r.layoutProductLengthCm=geometry.layoutLengthCm;r.layoutProductWidthCm=geometry.layoutWidthCm;
    r.quantity=quantity;
    const materialMatches=rules.materials.filter(m=>m && m.name===input.material);
    const priceMatches=rules.prices.filter(p=>p && p.material===input.material && p.color===input.color);
    if (materialMatches.length !== 1) e.push('材料档案缺失或重复，请选择唯一材料。');
    if (priceMatches.length !== 1) e.push('该材料与颜色的价格缺失或重复，禁止跨材料代用。');
    const material=materialMatches[0],price=priceMatches[0];
    confirmed(material,'材料参数',r);confirmed(price,'材料与颜色价格',r);
    if (price && price.basis !== '直接使用颜色原料价') e.push('颜色价格计价方式无法识别，请检查规则。');
    const density=areaPriced?null:number(material||{},'density','主档材料比重',e,{positive:true});
    const materialPrice=areaPriced?number(input,'clothPricePerM2','植布材料单价（元/㎡）',e,{positive:true}):number(price||{},'price','主档颜色原料价',e,{min:0});
    const clothProcessing=areaPriced?number(input,'clothProcessingPerSheet','植布固定加工费（元/张）',e,{min:0}):null;
    r.materialPriceUnit=areaPriced?'元/㎡':'元/kg';
    r.materialPrice=materialPrice;r.density=density;
    const layoutRules=rules.layout;
    confirmed(layoutRules,'排版参数',r);
    const settings={};
    for (const [key,label,positive] of [['maxLengthCm','最大片材长度',true],['maxWidthCm','最大片材宽度',true],['edgeCm','两端边料合计',false],['gapCm','产品间距',false]]) settings[key]=number(layoutRules,key,`主档${label}`,e,positive?{positive:true}:{min:0});
    if(areaPriced){settings.maxLengthCm=Math.min(settings.maxLengthCm,110);settings.maxWidthCm=Math.min(settings.maxWidthCm,70);r.warnings.push('植布整张片材上限：长110cm、宽70cm，包含出血位与边料。');}
    if (settings.edgeCm >= settings.maxLengthCm || settings.edgeCm >= settings.maxWidthCm) e.push('两端边料必须小于片材的长和宽。');
    const activeQuantity=rules.quantityRules.filter(q=>q && q.status==='已确认' && (q.material==='全部材料'||q.material===input.material));
    const quantityRows=activeQuantity.map(q=>({
      source:q,
      min:number(q,'min',`${q.name||'数量规则'}的数量下限`,e,{positive:true,integer:true}),
      max:number(q,'max',`${q.name||'数量规则'}的数量上限`,e,{positive:true,integer:true}),
      fee:number(q,'fee',`${q.name||'数量规则'}的小单费`,e,{min:0})
    }));
    if (quantityRows.some(q=>q.min>q.max)) e.push('数量规则下限不得大于上限。');

    const fees=fixedFees(input,[['moldFee','模具费'],['packagingFee','包装费'],['otherFee','其他费用']],r);
    const legacyMode=['低值','中值','高值'].includes(input.freightMode)?input.freightMode:null;
    const mode=blank(input.freightMode)||legacyMode?'按体积':input.freightMode;
    if (!['按体积','自提','手填'].includes(mode)) e.push('请选择有效运费方式。');
    const pack=number(input,'packPerBox','每箱装箱数',e,{positive:true,integer:true,optional:true});
    const freight=rules.freight;
    const volumeMode=mode==='按体积';
    if (volumeMode) confirmed(freight,'立方运费参数',r);
    const baseCavities=volumeMode&&pack===null?number(freight,'baseCavities','参考装箱基准模穴数',e,{positive:true,integer:true}):null;
    const basePack=volumeMode&&pack===null?number(freight,'basePackPerBox','参考基准每箱装箱数',e,{positive:true,integer:true}):null;
    const cartonLength=volumeMode?number(input,'cartonLengthCm','外箱长度',e,{positive:true,fallback:freight.cartonLengthCm}):null;
    const cartonWidth=volumeMode?number(input,'cartonWidthCm','外箱宽度',e,{positive:true,fallback:freight.cartonWidthCm}):null;
    const cartonHeight=volumeMode?number(input,'cartonHeightCm','外箱高度',e,{positive:true,fallback:freight.cartonHeightCm}):null;
    const migratedRate=freight.ratePerM3??(Number(freight.midPerBox)*1000000/(Number(freight.cartonLengthCm)*Number(freight.cartonWidthCm)*Number(freight.cartonHeightCm)));
    const configuredRate=volumeMode?number({ratePerM3:migratedRate},'ratePerM3','每立方运价',e,{min:0}):null;
    const cartonVolume=volumeMode?cartonLength*cartonWidth*cartonHeight/1000000:null;
    const legacyRate=legacyMode&&cartonVolume>0?number(freight,{'低值':'lowPerBox','中值':'midPerBox','高值':'highPerBox'}[legacyMode],'旧版每箱运费',e,{min:0})/cartonVolume:null;
    const ratePerM3=volumeMode?(legacyRate??configuredRate):null;
    const manualFreight=mode==='手填'?number(input,'freightTotal','手填整单运费',e,{min:0}):null;
    if (e.length) return finiteResult(r);
    const alternatives=[candidate(geometry.layoutLengthCm,geometry.layoutWidthCm,r.layoutAllowanceCm,settings,false),...(areaPriced?[]:[candidate(geometry.layoutLengthCm,geometry.layoutWidthCm,r.layoutAllowanceCm,settings,true)])];
    r.alternatives=alternatives;
    r.layout=alternatives.slice().sort((a,b)=>b.cavities-a.cavities || a.areaCm2-b.areaCm2)[0];
    const layout=r.layout;
    if (layout.cavities<1 || !Number.isSafeInteger(layout.cavities) || layout.sheetLengthCm>settings.maxLengthCm+1e-9 || layout.sheetWidthCm>settings.maxWidthCm+1e-9) {e.push('产品无法在片材尺寸内有效排版，请核对尺寸。');return finiteResult(r);}
    const adoptedCavities=layout.cavities;
    r.theoreticalCavities=layout.cavities;
    r.adoptedCavities=layout.cavities;
    r.cavitySource='layout';
    const processingTier=areaPriced?{label:'植布固定加工费',baseFee:clothProcessing,increment:0,referenceFee:clothProcessing,effectiveFee:clothProcessing}:processingFeeForMaterial(adoptedCavities,material,rules.processingTiers||defaultRules.processingTiers);
    if (!processingTier) {e.push('当前排版数量没有唯一加工费档位（仅支持1–100个），请检查加工费参数。');return finiteResult(r);}
    r.thicknessSource=areaPriced?'area':thickness===null?'equivalent':'measured';
    r.thicknessMm=areaPriced?null:thickness===null?weight/geometry.areaCm2/density*10:thickness;
    if (!areaPriced&&thickness===null) r.warnings.push(`未填实测厚度：已按${geometry.shapeLabel}投影面积 ${geometry.areaCm2.toFixed(3)} cm²和单件克重反算估算厚度 ${r.thicknessMm.toFixed(3)} mm；该数值仅用于本次报价。`);
    r.sheetMaterialCost=areaPriced?layout.areaCm2/10000*materialPrice:layout.areaCm2*r.thicknessMm*density*materialPrice/10000;
    r.sheetAreaM2=layout.areaCm2/10000;
    r.processingTier=processingTier;
    r.processingTierLabel=processingTier.label;
    r.baseSheetProcessingCost=processingTier.baseFee;
    r.processingIncrement=processingTier.increment;
    r.processingReferenceFee=processingTier.referenceFee;
    r.processingMultiplier=processingTier.baseFee>0?processingTier.effectiveFee/processingTier.baseFee:null;
    r.sheetProcessingCost=processingTier.effectiveFee;
    r.baseUnit=(r.sheetMaterialCost+r.sheetProcessingCost)/adoptedCavities;
    r.theoreticalSheets=quantity/adoptedCavities/(1-reject/100);
    r.productionSheets=Math.ceil(r.theoreticalSheets);
    r.warnings.push(moldType==='female'?`阴模排版按产品外形长宽各增加总出血位 ${bleed.toFixed(3)} cm，不叠加产品高度。`:`阳模排版按产品外形长宽各增加产品高度 ${height.toFixed(3)} cm。`);
    r.warnings.push('材料和成型加工保持原公式的连续张数计价；整张生产数仅供排产参考。边料已计入片材面积，不重复加损耗。');
    r.smallOrderCount=quantity/adoptedCavities;
    const matches=quantityRows.filter(q=>(q.min===1?0:q.min)<=r.smallOrderCount && r.smallOrderCount<q.max+1);
    if(matches.length!==1){e.push('小单张数没有唯一已确认的费用档位，请检查张数区间。');return finiteResult(r);}
    r.smallOrderFee=matches[0].fee;
    r.warnings.push('小单数＝总数量 '+quantity+' ÷ 采用穴数 '+adoptedCavities+'＝'+r.smallOrderCount.toFixed(4)+'张；本单小单费 '+r.smallOrderFee+'元（整单一次）。');
    r.packPerBox=volumeMode?(pack===null?Math.max(1,Math.floor(basePack*adoptedCavities/baseCavities)):pack):pack;
    r.boxes=volumeMode?Math.ceil(quantity/r.packPerBox):null;
    r.cartonLengthCm=cartonLength;r.cartonWidthCm=cartonWidth;r.cartonHeightCm=cartonHeight;
    r.cartonVolumeM3=cartonVolume;r.freightVolumeM3=volumeMode?r.boxes*cartonVolume:null;r.freightRatePerM3=ratePerM3;
    if (volumeMode&&pack===null) r.warnings.push('每箱装量按历史比例估算；总立方和运费会随估算箱数变化，请优先填写实际每箱装量。');
    if (legacyMode) r.warnings.push('旧版运费档位已迁移为立方运价，请在参数表核对每立方运价。');
    r.freightTotal=mode==='自提'?0:mode==='手填'?manualFreight:round2(r.freightVolumeM3*ratePerM3);
    r.breakdown=[
      {label:'片材材料（含边料及额外不良）',amount:r.sheetMaterialCost*r.theoreticalSheets},
      {label:areaPriced?`植布固定加工（${r.sheetProcessingCost.toFixed(2)}元/张，含额外不良）`:`成型加工（${adoptedCavities}个排版，材料起步${r.baseSheetProcessingCost.toFixed(2)}＋穴数差额${r.processingIncrement.toFixed(2)}＝${r.sheetProcessingCost.toFixed(2)}元/张，含额外不良）`,amount:r.sheetProcessingCost*r.theoreticalSheets},
      {label:'小单费（每单一次）',amount:r.smallOrderFee},
      ...fees.map(({label,amount})=>({label,amount})),
      {label:volumeMode?`运费（${r.boxes}箱 × ${r.cartonVolumeM3.toFixed(4)}m³/箱 × ${r.freightRatePerM3.toFixed(2)}元/m³）`:'运费',amount:r.freightTotal}
    ];
    r.costTotal=r.breakdown.reduce((sum,line)=>sum+line.amount,0);
    r.costUnit=r.costTotal/quantity;
    r.warnings.push(rules.source?.notice || '规则为原主档历史快照，对客报价前请核实当前价格。');
    const materialTaxFactor=number(material,'taxFactor','主档含税系数',r.blockers,{min:1});
    r.materialTaxFactor=materialTaxFactor;
    const taxFactor=input.taxIncluded===true?materialTaxFactor:1;
    r.passthroughTotal=fees.reduce((sum,item)=>sum+item.amount,0)+r.freightTotal;
    finishPricing(r,input,taxFactor,r.passthroughTotal);
    if(r.targetMargin!==null&&materialTaxFactor!==null){r.untaxedSuggestedUnit=up4((r.pricedCostTotal/(1-r.targetMargin/100)+r.passthroughTotal)/r.quantity);r.taxIncludedSuggestedUnit=up4((r.pricedCostTotal*materialTaxFactor/(1-r.targetMargin/100)+r.passthroughTotal)/r.quantity);}
    if(r.finalUnit!==null&&materialTaxFactor!==null){const selectedTotal=r.finalUnit*r.quantity,netTotal=input.taxIncluded===true?(selectedTotal-r.passthroughTotal)/materialTaxFactor+r.passthroughTotal:selectedTotal,taxTotal=input.taxIncluded===true?selectedTotal:(selectedTotal-r.passthroughTotal)*materialTaxFactor+r.passthroughTotal;r.untaxedFinalUnit=up4(netTotal/r.quantity);r.taxIncludedFinalUnit=up4(taxTotal/r.quantity);}
    return finiteResult(r);
  }

module.exports={calculateTray};
