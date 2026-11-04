'use strict';
const fs=require('fs'),path=require('path');
const {calculateTray}=require('./tray-engine.cjs');
const missing=x=>x===undefined||x===null||typeof x==='string'&&x.trim()==='';
const n=(x,label,{zero=false}={})=>{if(typeof x==='boolean'||missing(x)||!Number.isFinite(Number(x))||(zero?Number(x)<0:Number(x)<=0))throw Error(`${label}须为有效${zero?'非负数':'正数'}。`);return Number(x)};
function heightEstimate(name,height){const h=n(height,'高度');let v;if(/^(普通)?PVC|^PET|^触感PET|^镀金PET/.test(name))v=h*.1;else if(/^PS/.test(name))v=h*.1+.1;else if(/^PP/.test(name))v=(h*.1+.1)*1.1;else throw Error('材料没有对应高度估厚规则。');const x=Math.floor((v*100+1e-9)/5+.5)*.05;if(x<=0)throw Error('估算厚度归整为零，请核对。');return Number(x.toFixed(2));}
function quoteRaw(order,config){
 if(!order||typeof order!=='object'||Array.isArray(order))throw Error('订单须为JSON对象。');
 const machine=config.machine,cloth=order.material==='植布';if(!machine||!Array.isArray(config.materials)||!Array.isArray(config.processing_tiers)||!Array.isArray(config.small_order_tiers))throw Error('参数文件缺少机器、材料或费用档位；请使用参考参数格式。');
 if(machine.total_edge_length_cm!==machine.total_edge_width_cm)throw Error('当前程序只支持两方向边料合计相同，请核对机器配置。');
 let entries=cloth?[]:config.materials.filter(m=>m.material===order.material&&m.color===order.color);if(!cloth&&entries.length!==1)throw Error('材料与颜色参数缺失或重复，请核对。');
 const entry=cloth?config.cloth:entries[0];if(cloth&&!['白色','黑色','其他'].includes(order.color))throw Error('植布颜色请选择白色、黑色或其他。');
 const density=cloth?null:n(entry.density_g_cm3,'材料比重'),price=n(cloth?entry.price_per_m2:entry.price_per_kg,'材料单价'),base=n(cloth?entry.processing_per_sheet:(entry.processing_base_per_sheet??config.default_processing_per_sheet),'加工费',{zero:true}),tax=n(config.tax_multiplier,'含税系数');if(tax<1)throw Error('含税系数不能小于1。');
 let thickness=order.measured_thickness_mm,weight=order.weight_g;for(const [name,value] of [['厚度',thickness],['克重',weight]])if(!missing(value))n(value,name);
 let assumed=[];let mold=order.mold_type;if(missing(mold)){if(!config.allow_preliminary_male_mold_default&&!cloth)throw Error('请选择模具类型。');mold=cloth?'female':'male';assumed.push('未提供模具，暂按'+(cloth?'阴模':'阳模')+'计算。');}
 if(!['male','female'].includes(mold))throw Error('模具类型请选择 male 或 female。');
 let bleedCm=config.female_total_bleed_cm;if(mold==='female'&&!missing(order.total_bleed_cm)){bleedCm=n(order.total_bleed_cm,'阴模总出血');assumed.push('阴模总出血为手工填写，需复核。');}
 if(!cloth&&missing(thickness)&&missing(weight)){if(!config.allow_height_based_estimate)throw Error('请提供厚度或克重。');thickness=heightEstimate(order.material,order.height_cm);assumed.push('厚度按高度估算，仅供参考。');}
 if(!cloth&&order.material.includes('植绒')){
  if(!missing(order.thickness_basis)&&order.thickness_basis!=='substrate')throw Error('植绒厚度须为裸基材厚度。');
  if(missing(thickness))throw Error('植绒净重无法直接使用，请提供与成品参数配套的裸基材厚度。');
  assumed.push('采用材料参考单价与比重，适用于简易估价。');
 }
 if(!cloth&&missing(thickness)&&!missing(weight))assumed.push('厚度按净重反推，为估算值。');
 const quantityRules=config.small_order_tiers.map((t,i)=>({name:'小单费档'+(i+1),material:'全部材料',min:t.min_sheets_inclusive===0?1:t.min_sheets_inclusive,max:t.max_sheets_exclusive===null?1000000000:t.max_sheets_exclusive-1,fee:t.fee,status:'已确认'}));
 const rules={materials:[{name:order.material,density,processingPerSheet:base,taxFactor:tax,status:'已确认'}],prices:[{material:order.material,color:order.color,price,basis:'直接使用颜色原料价',status:'已确认'}],processingTiers:config.processing_tiers.map(t=>({min:t.min_cavities,max:t.max_cavities,fee:.6+t.surcharge_per_sheet,status:'已确认'})),quantityRules,layout:{maxLengthCm:machine.max_length_cm,maxWidthCm:machine.max_width_cm,edgeCm:machine.total_edge_length_cm,gapCm:machine.gap_cm,status:'已确认'},freight:{status:'已确认'},source:{notice:config.notice||'参数为参考值，使用前请核对。'}};
 const pt=order.pass_through||{}, freight=pt.freight||{mode:'pickup'}, mode=freight.mode||'pickup';if(!['pickup','manual','volume'].includes(mode))throw Error('运费方式只支持 pickup、manual、volume。');if(mode==='volume'){
  for(const key of ['pieces_per_box','carton_length_cm','carton_width_cm','carton_height_cm','rate_per_m3'])n(freight[key],key,{zero:key==='rate_per_m3'});
  Object.assign(rules.freight,{cartonLengthCm:freight.carton_length_cm,cartonWidthCm:freight.carton_width_cm,cartonHeightCm:freight.carton_height_cm,ratePerM3:freight.rate_per_m3});
 }
 const frac=(value,label)=>{const a=missing(value)?0:n(value,label,{zero:true});if(a>=1)throw Error(label+'必须小于1。');return a*100};
 const input={shape:order.shape||'rectangle',lengthCm:order.length_cm,widthCm:order.width_cm,heightCm:order.height_cm,customAreaCm2:order.custom_area_cm2,moldType:mold,bleedCm,quantity:order.quantity,material:order.material,color:order.color,thicknessMm:thickness,weightG:weight,rejectRate:frac(order.defect_rate,'不良率'),targetMargin:frac(order.extra_margin_rate??config.default_extra_margin_rate,'额外毛利率'),minMargin:frac(config.minimum_margin_rate,'最低毛利率'),taxIncluded:order.tax_included??true,priceConfirmed:true,manualUnit:'',clothPricePerM2:cloth?price:undefined,clothProcessingPerSheet:cloth?base:undefined,moldFee:pt.mold_fee??0,packagingFee:pt.packaging_fee??0,otherFee:pt.other_fee??0,freightMode:mode==='manual'?'手填':mode==='volume'?'按体积':'自提',freightTotal:freight.amount,packPerBox:freight.pieces_per_box};
 if(typeof input.taxIncluded!=='boolean')throw Error('tax_included 必须为 true 或 false。');
 const result=calculateTray(input,rules);const errors=[...result.errors,...result.blockers];if(errors.length||!result.canQuote)return {status:'blocked',errors,warnings:result.warnings};
 // Show both prices using independent calculations before unit rounding.
 const other=calculateTray({...input,taxIncluded:!input.taxIncluded},rules);
 const resultPrice=input.taxIncluded?result:other, resultUntaxed=input.taxIncluded?other:result;
 // Avoid displaying the rounded reverse-converted figure beside the independently calculated price.
 delete result.untaxedFinalUnit; delete result.taxIncludedFinalUnit; delete result.untaxedSuggestedUnit; delete result.taxIncludedSuggestedUnit;
 return {status:'pending_review',status_reason:'参考参数及假设需使用者核对',assumptions:assumed,mold_defaulted:assumed.some(item=>item.includes('未提供模具')),selected:input.taxIncluded?'含税':'未税',taxed_unit:resultPrice.finalUnit,untaxed_unit:resultUntaxed.finalUnit,taxed_total:resultPrice.total,untaxed_total:resultUntaxed.total,calculation:result};
}
function flockWeightThickness(order,config){
 const entries=config.materials.filter(m=>m.material===order.material&&m.color===order.color);
 if(entries.length!==1)throw Error('材料与颜色参数缺失或重复，请核对。');
 if(!['finished','substrate'].includes(order.weight_basis))throw Error('请确认克重是植绒后成品还是植绒前裸片，并填写 weight_basis。');
 const length=n(order.length_cm,'长度'),weight=n(order.weight_g,'单件克重'),shape=order.shape||'rectangle';
 let area;
 if(shape==='circle')area=Math.PI*length*length/4;
 else if(shape==='hexagon')area=3*Math.sqrt(3)*length*length/8;
 else if(shape==='custom')area=n(order.custom_area_cm2,'实际投影面积');
 else {const width=n(order.width_cm,'宽度');if(shape==='rectangle')area=length*width;else if(shape==='ellipse')area=Math.PI*length*width/4;else if(shape==='triangle')area=length*width/2;else throw Error('请选择有效的产品形状。');}
 let density=entries[0].density_g_cm3;
 if(order.weight_basis==='substrate'){
  const base={'PVC植绒':'普通PVC','PS植绒':'PS','PET植绒':'PET'}[order.material];
  const bare=config.materials.filter(x=>x.material===base&&x.color===order.color);
  if(!base||bare.length!==1)throw Error('裸基材参考比重缺失或重复，请核对。');
  density=bare[0].density_g_cm3;
 }
 return weight*10/(area*n(density,'参考比重'));
}
function labelReview(result){
 if(!result||result.status==='blocked')return result;
 if(Array.isArray(result.assumptions)&&result.assumptions.length){
  if(!result.assumptions.includes('初步报价、待复核'))result.assumptions.unshift('初步报价、待复核');
  result.review_label='初步报价、待复核';
 }else result.review_label=null;
 return result;
}
function quote(order,config){
 const flocked=String(order?.material||'').includes('植绒'), inferred=flocked&&missing(order.measured_thickness_mm)&&!missing(order.weight_g);
 let r;
 if(inferred){
  if(!missing(order.thickness_basis)&&order.thickness_basis!=='substrate')throw Error('植绒厚度须为裸基材厚度。');
  const t=flockWeightThickness(order,config);
  if(!Number.isFinite(t)||t<=0||t>100)throw Error('克重估算厚度无效，请核对。');
  r=quoteRaw({...order,measured_thickness_mm:t},config);
  if(r.status!=='blocked'){
   r.calculation.thicknessSource=order.weight_basis==='finished'?'flock_finished_equivalent':'flock_substrate_estimate';
   r.assumptions.push(order.weight_basis==='finished'?'按植绒参考比重和成品克重估算等效厚度，仅用于参考报价，不是裸基材厚度。':'按裸基材参考比重和裸片克重估算厚度，需实测复核。');
  }
 }else{
  r=quoteRaw(order,config);
  if(flocked&&missing(order.measured_thickness_mm)&&missing(order.weight_g)&&r.status!=='blocked')r.calculation.thicknessSource='heightReference';
 }
 return labelReview(r);
}
async function quoteWithFlockWeight(order,config){return quote(order,config);}
if(require.main===module){(async()=>{try{const [orderFile,configFile]=process.argv.slice(2);if(!orderFile)throw Error('用法：node scripts/quote.cjs 订单.json [参数.json]');const order=JSON.parse(fs.readFileSync(orderFile,'utf8')),config=JSON.parse(fs.readFileSync(configFile||path.join(__dirname,'../assets/parameters.reference.json'),'utf8'));const result=await quoteWithFlockWeight(order,config);console.log(JSON.stringify(result,null,2));if(result.status==='blocked')process.exitCode=2;}catch(e){console.error(JSON.stringify({status:'blocked',errors:[e.message]}));process.exitCode=2;}})();}
module.exports={quote,quoteWithFlockWeight,heightEstimate};
