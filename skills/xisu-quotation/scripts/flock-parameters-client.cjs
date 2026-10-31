'use strict';
const DEFAULT_ENDPOINT='https://tonghoupack.com/quote/api/flock-parameters';
async function resolveParameters(input,endpoint=process.env.XISU_FLOCK_PARAMETERS_URL||DEFAULT_ENDPOINT){
 let url;try{url=new URL(endpoint);}catch{throw Error('植绒材料核定服务地址无效。');}
 const local=url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(!(url.href===DEFAULT_ENDPOINT||(local&&url.pathname==='/api/flock-parameters'&&!url.username&&!url.password&&!url.search&&!url.hash)))throw Error('植绒材料核定服务地址无效。');
 let response,data;try{response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(5000),redirect:'error'});data=await response.json();}catch{throw Error('植绒材料核定服务不可用，请联网后重试。');}
 if(response.status===429)throw Error('请求频繁，请稍后重试。');
 if(!response.ok)throw Error(response.status===422?'植绒材料或厚度无法核定，请核对。':'植绒材料核定服务不可用，请联网后重试。');
 if(!data||Object.keys(data).sort().join(',')!=='density,pricePerKg'||!Number.isFinite(data.pricePerKg)||data.pricePerKg<=0||!Number.isFinite(data.density)||data.density<=0)throw Error('植绒材料核定服务结果无效，请稍后重试。');
 return data;
}
module.exports={resolveParameters};
