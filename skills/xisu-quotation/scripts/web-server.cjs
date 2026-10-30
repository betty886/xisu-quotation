'use strict';
// Local-only HTTP adapter for the same public calculation engine used by the Skill.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {quoteWithFlockWeight} = require('./quote.cjs');
const root = path.resolve(__dirname, '..');
const web = path.join(root, 'web');
const parameterFile = path.join(root, 'assets', 'parameters.reference.json');
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/mold-guide.svg', ['mold-guide.svg', 'image/svg+xml']]
]);
const allowedFields = new Set(['variantId','length','width','height','dimensionUnit','quantity','thicknessMm','weightG','weightBasis','moldType','shape']);
const empty = x => x == null || typeof x === 'string' && !x.trim();
class RequestError extends Error { constructor(message, field, status=422) { super(message); this.field=field; this.status=status; } }
function num(value, label, field, {optional=false, allowZero=false, integer=false, max=1e9}={}) {
  if (empty(value)) { if (optional) return null; throw new RequestError(`请填写${label}。`,field); }
  if (!(typeof value==='number' || typeof value==='string' && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) throw new RequestError(`${label}请填写有效数字。`,field);
  const v=Number(value);
  if (!Number.isFinite(v) || (allowZero ? v<0 : v<=0) || v>max || (integer && !Number.isSafeInteger(v))) throw new RequestError(`${label}须为有效${integer?'正整数':allowZero?'非负数':'正数'}。`,field);
  return v;
}
function loadConfig(file=parameterFile) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function variants(config) {
  if(!config || !Array.isArray(config.materials) || !config.cloth) throw Error('Invalid parameter file');
  const items=config.materials.map(x=>({material:x.material,color:x.color}));
  for(const color of ['白色','黑色','其他']) items.push({material:'植布',color});
  const keys=new Set();
  return items.map(({material,color})=>{
    if(typeof material!=='string'||typeof color!=='string'||!material||!color) throw Error('Invalid material');
    const key=JSON.stringify([material,color]);if(keys.has(key)) throw Error('Duplicate material');keys.add(key);
    return {variantId:'v_'+crypto.createHash('sha256').update(key).digest('hex').slice(0,12),material,color,
      label:material==='PET透明'?'PET透明':`${material} · ${color}`,requiresThicknessWeight:material!=='植布'};
  });
}
async function calculate(payload, config, options={}) {
  if (!payload || typeof payload!=='object' || Array.isArray(payload)) throw new RequestError('请填写有效规格。',undefined,400);
  if (Object.keys(payload).some(k=>!allowedFields.has(k))) throw new RequestError('报价规格包含不支持的字段。',undefined,400);
  const selected=variants(config).find(v=>v.variantId===payload.variantId);
  if (!selected) throw new RequestError('请选择材质与颜色。','variantId');
  if (!['male','female'].includes(payload.moldType)) throw new RequestError('请选择阴模或阳模。','moldType');
  if (!['cm','mm'].includes(payload.dimensionUnit)) throw new RequestError('请选择尺寸单位。','dimensionUnit');
  const shape=payload.shape || 'rectangle';if(!['rectangle','circle','ellipse','hexagon','triangle'].includes(shape))throw new RequestError('请选择支持的产品形状。','shape');
  const max=payload.dimensionUnit==='mm'?10000:1000,div=payload.dimensionUnit==='mm'?10:1;
  const l=num(payload.length,'产品长度','length',{max});
  const w=num(payload.width,'产品宽度','width',{optional:['circle','hexagon'].includes(shape),max});
  const h=num(payload.height,'产品高度','height',{allowZero:true,max});
  const quantity=num(payload.quantity,'订单数量','quantity',{integer:true,max:100000000});
  const thickness=num(payload.thicknessMm,'厚度','thicknessMm',{optional:true,max:100});
  const weight=num(payload.weightG,'单件克重','weightG',{optional:true,max:1000000});
  if(selected.material.includes('植绒') && thickness===null && weight!==null && !['finished','substrate'].includes(payload.weightBasis))throw new RequestError('请选择植绒克重的称重阶段。','weightBasis');
  const order={material:selected.material,color:selected.color,shape,length_cm:l/div,width_cm:w===null?undefined:w/div,height_cm:h/div,quantity,mold_type:payload.moldType,
    ...(thickness!==null?{measured_thickness_mm:thickness}:{}), ...(weight!==null?{weight_g:weight}:{}), ...(selected.material.includes('植绒')&&thickness===null&&weight!==null?{weight_basis:payload.weightBasis}:{}),tax_included:true};
  let result;
  try { result=await quoteWithFlockWeight(order,config,options); } catch(e) {throw new RequestError(e.message);}
  if(result.status==='blocked'||![result.taxed_unit,result.untaxed_unit,result.taxed_total].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>0)) throw new RequestError(result.errors?.join('；')||'该规格暂无法自动报价，请核对输入。');
  const thicknessSource=selected.material==='植布'?'not_required':thickness!==null?'measured':weight!==null?'weight_estimate':'height_estimate';
  const notes=['价格为参考报价，具体订单请核对材料、规格和费用。'];
  if(thicknessSource==='weight_estimate')notes.push(selected.material.includes('植绒')?`按${payload.weightBasis==='finished'?'植绒后成品':'植绒前裸片'}单件净重估算裸基材厚度；联网服务采用参考工艺，实际样品需复核。`:'按单件净重估算厚度，需复核。');
  if(thicknessSource==='height_estimate')notes.push('按产品高度估算厚度，需复核。');
  if(selected.material==='植布')notes.push('植布按面积报价，产品长宽方向固定。');
  const thicknessMm=thicknessSource==='not_required'?null:result.calculation.thicknessMm;
  if(thicknessSource!=='not_required'&&!(Number.isFinite(thicknessMm)&&thicknessMm>0))throw new RequestError('厚度计算结果无效，请核对输入。');
  return {referenceUnitPrice:result.taxed_unit,untaxedUnitPrice:result.untaxed_unit,total:result.taxed_total,quantity,currency:'CNY',taxIncluded:true,thicknessSource,thicknessMm,reference:true,notes,exclusions:['运费','模具费','包装费及其他特殊要求费用']};
}
function sendJson(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
function readJson(req) {
  return new Promise((resolve,reject)=>{let chunks=[],size=0,rejected=false;const timer=setTimeout(()=>{if(!rejected){rejected=true;reject(new RequestError('请求超时。',undefined,408));req.resume();}},5000);
    req.on('data',chunk=>{size+=chunk.length;if(size>8192){if(!rejected){rejected=true;reject(new RequestError('请求内容过长。',undefined,413));}chunks=[];return;}if(!rejected)chunks.push(chunk);});
    req.on('end',()=>{clearTimeout(timer);if(rejected)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(new RequestError('输入格式无效。',undefined,400))}});
    req.on('error',err=>{clearTimeout(timer);if(!rejected){rejected=true;reject(err)}});
    req.on('aborted',()=>{clearTimeout(timer);if(!rejected){rejected=true;reject(new RequestError('请求已中断。',undefined,400))}});
  });
}
function createServer({configPath=parameterFile,resolveThickness}={}) {
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    try {
      const port=server.address()?.port,host=(req.headers.host||'').toLowerCase();
      const hostCount=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()==='host').length;
      if(hostCount!==1 || ![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))throw new RequestError('请通过本机报价页面访问。',undefined,403);
      const origin=req.headers.origin;
      if(origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(origin))throw new RequestError('请求来源不受支持。',undefined,403);
      const requestUrl=new URL(req.url,'http://127.0.0.1');const pathname=requestUrl.pathname;
      if(req.method==='GET'&&pathname==='/api/options')return sendJson(res,200,{variants:variants(loadConfig(configPath))});
      if(req.method==='POST'&&pathname==='/api/quote'){
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new RequestError('请提交JSON格式。',undefined,415);
        const body=await readJson(req);return sendJson(res,200,await calculate(body,loadConfig(configPath),resolveThickness?{resolveThickness}:{}));
      }
      if(req.method!=='GET' && req.method!=='HEAD')throw new RequestError('请求方式不受支持。',undefined,405);
      const entry=staticFiles.get(pathname);if(!entry)throw new RequestError('页面不存在。',undefined,404);
      let file;try{file=fs.readFileSync(path.join(web,entry[0]));}catch{throw new RequestError('页面暂不可用，请检查安装文件。',undefined,404)}
      res.writeHead(200,{'Content-Type':entry[1],'Content-Length':file.length});res.end(req.method==='HEAD'?undefined:file);
    } catch(e) {if(res.headersSent||res.destroyed)return;const known=e instanceof RequestError;sendJson(res,known?e.status:500,{error:{message:known?e.message:'报价服务暂不可用，请核对参数文件。',...(known&&e.field?{field:e.field}:{})}});}
  });return server;
}
function openBrowser(url) {
 const {spawn}=require('node:child_process');
 let cmd,args;
 if(process.platform==='win32'){cmd='rundll32.exe';args=['url.dll,FileProtocolHandler',url];}
 else if(process.platform==='darwin'){cmd='open';args=[url];}
 else {cmd='xdg-open';args=[url];}
 const child=spawn(cmd,args,{detached:true,stdio:'ignore',windowsHide:true});
 child.on('error',()=>console.error('无法自动打开浏览器，请手动访问上面的地址。'));child.unref();
}
if(require.main===module){
 try {
  const raw=process.env.QUOTE_PORT||'18771';if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>65535)throw Error('QUOTE_PORT 须为 1 至 65535 的端口。');
  const args=process.argv.slice(2);let configPath=parameterFile,shouldOpen=false;
  for(let i=0;i<args.length;i++){if(args[i]==='--open'){shouldOpen=true;continue;}if(args[i]==='--config'&&i+1<args.length){configPath=path.resolve(args[++i]);continue;}throw Error('用法：node scripts/web-server.cjs [--open] [--config 参数文件.json]');}
  variants(loadConfig(configPath));
  const server=createServer({configPath});server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'端口已被使用；请设置 QUOTE_PORT 后重试。':'报价服务启动失败：'+e.message);process.exitCode=1});
  server.listen(Number(raw),'127.0.0.1',()=>{const url=`http://127.0.0.1:${server.address().port}/`;console.log('报价页面已启动：'+url);if(shouldOpen)openBrowser(url);});
 }catch(e){console.error('报价服务启动失败：'+e.message);process.exitCode=1;}
}
module.exports={createServer,calculate,variants};
