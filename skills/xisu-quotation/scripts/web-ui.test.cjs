'use strict';
const {chromium, expect}=require('@playwright/test');
const {createServer}=require('./web-server.cjs');
(async()=>{
 const password='test-only-gate';const server=createServer({password});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const viewport of [{width:1365,height:900},{width:390,height:844}]){
   const p=await browser.newPage({viewport});await p.addInitScript(()=>{window.__copied='';Object.defineProperty(navigator,'clipboard',{value:{writeText:async s=>{window.__copied=s;}}});});
   await p.goto(base);await expect(p.locator('#password')).toBeVisible();await expect(p.locator('#variant')).toHaveCount(0);
   await p.locator('#password').fill('wrong-password');await p.locator('#login').click();await expect(p.locator('#login-error')).toBeVisible();await expect(p.locator('#login-error')).toContainText('口令');
   await p.locator('#password').fill(password);await p.locator('#login').click();await expect(p.locator('#variant')).toBeEnabled();
   await p.locator('#variant').selectOption({label:'PET透明'});
   for(const [id,value] of Object.entries({length:'20',width:'10',height:'2',quantity:'10000'}))await p.locator('#'+id).fill(value);
   await p.locator('label').filter({has:p.locator('#mold-male')}).click();await p.locator('#calculate').click();
   await expect(p.locator('#result-message')).toContainText('按高度估算厚度：0.200 mm（20.00 丝）');await expect(p.locator('#result-message')).toBeVisible();
   await p.locator('#copy-quote').click();await expect.poll(()=>p.evaluate(()=>window.__copied)).toContain('按高度估算厚度：0.200 mm（20.00 丝）');
   await p.locator('label').filter({has:p.locator('input[name="measurementMode"][value="weight"]')}).click();await p.locator('#weight').fill('11.2');await p.locator('#calculate').click();
   await expect(p.locator('#result-message')).toContainText('按克重反推厚度：0.400 mm（40.00 丝）');await expect(p.locator('#result-message')).toBeVisible();
   await p.locator('#copy-quote').click();await expect.poll(()=>p.evaluate(()=>window.__copied)).toContain('按克重反推厚度：0.400 mm（40.00 丝）');
   await p.locator('label').filter({has:p.locator('input[name="measurementMode"][value="thickness"]')}).click();await p.locator('#thickness').fill('.8');await p.locator('#calculate').click();await expect(p.locator('#result-message')).toContainText('按本次规格计算');
   await p.locator('#variant').selectOption({label:'植布 · 白色'});await p.locator('#calculate').click();await expect(p.locator('#copy-quote')).toBeEnabled();await p.locator('summary').filter({hasText:'规格与报价说明'}).click();await expect(p.locator('#spec-summary')).not.toContainText('厚度');
   console.log(`PASS ${viewport.width}px 高度估算、克重反推、实测、植布、复制`);await p.close();
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
