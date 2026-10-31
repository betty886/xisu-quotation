'use strict';
const {chromium,expect}=require('@playwright/test');const {createServer}=require('./web-server.cjs');
(async()=>{
 let slow=false,fail=false;
 const server=createServer({resolveParameters:async({thicknessMm})=>{if(fail)throw Error('请求频繁，请稍后重试。');if(slow&&thicknessMm===.4)await new Promise(r=>setTimeout(r,1600));return {pricePerKg:thicknessMm===.4?8:9,density:thicknessMm===.4?1.5:1.6};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const viewport of [{width:1365,height:900},{width:390,height:844}]){
   const p=await browser.newPage({viewport});await p.goto(`http://127.0.0.1:${server.address().port}`);await expect(p.locator('#variant')).toBeEnabled();await p.locator('#variant').selectOption({label:'PET植绒 · 白色'});
   for(const [id,value] of Object.entries({length:'20',width:'10',height:'2',quantity:'10000'}))await p.locator('#'+id).fill(value);await p.locator('label').filter({has:p.locator('#mold-male')}).click();
   await p.locator('#calculate').click();await expect(p.locator('#result-message')).toContainText('按高度估算厚度：0.200');await expect(p.locator('#result-message')).toContainText('植绒比重');await expect(p.locator('#result-message')).toContainText('材料单价');
   slow=true;await p.locator('#thickness').fill('.4');await p.waitForTimeout(500);await p.locator('#thickness').fill('.8');await p.locator('#calculate').click();await expect(p.locator('#result-message')).toContainText('1.600000');await p.waitForTimeout(1900);await expect(p.locator('#result-message')).toContainText('1.600000');await expect(p.locator('#result-message')).not.toContainText('1.500000');
   fail=true;await p.locator('#thickness').fill('.9');await p.locator('#calculate').click();await expect(p.locator('#form-error')).toContainText('请求频繁');await expect(p.locator('#unit-price')).toHaveText('—');
   fail=false;slow=false;await p.close();
   console.log(`PASS ${viewport.width}px 高度估算、动态参数可见、延迟竞态及限流阻断`);
  }
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
