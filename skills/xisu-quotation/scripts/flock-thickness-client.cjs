'use strict';

// This service returns only the estimated substrate thickness; no private process is bundled.
const DEFAULT_ENDPOINT='https://tonghoupack.com/quote/api/flock-thickness';
async function resolveThickness(input, endpoint=process.env.XISU_FLOCK_THICKNESS_URL||DEFAULT_ENDPOINT) {
  let url;
  try { url=new URL(endpoint); } catch { throw Error('植绒克重反推服务地址无效。'); }
  const local=url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (!(url.href===DEFAULT_ENDPOINT||(local&&url.pathname==='/api/flock-thickness'&&!url.username&&!url.password&&!url.search&&!url.hash))) throw Error('植绒克重反推服务地址无效。');
  let response, data;
  try {
    response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(5000),redirect:'error'});
    data=await response.json();
  } catch { throw Error('植绒克重反推服务不可用；请稍后重试或填写裸基材厚度。'); }
  if(!response.ok){
    if(response.status===422) throw Error('克重与尺寸或称重阶段不匹配，请核对后重试。');
    throw Error('植绒克重反推服务不可用；请稍后重试或填写裸基材厚度。');
  }
  if(!data||Object.keys(data).length!==1||!Number.isFinite(data.thicknessMm)||data.thicknessMm<=0||data.thicknessMm>100) throw Error('植绒克重反推服务结果无效；请核对或填写裸基材厚度。');
  return data.thicknessMm;
}
module.exports={resolveThickness};
