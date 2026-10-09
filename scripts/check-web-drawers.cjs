// Run against the worktree Vite server and a local runtime. API mutations are intercepted.
// PLAYWRIGHT_MODULE may point to an existing Playwright install.
// CHROMIUM_EXECUTABLE may select a cached browser instead of Playwright's default.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const launch={headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})};
const baseURL=process.env.DRAWER_CHECK_BASE_URL || 'http://127.0.0.1:5187';
const assert=require('node:assert/strict');
async function fixture(page){
  await page.addInitScript(()=>{localStorage.setItem('lfg_user','demo@example.com');localStorage.setItem('lfg_v2_user_filter','__all')});
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(req.method()!=='GET')return route.fulfill({json:{ok:true}});
    if(['/api/sessions','/api/threads','/api/bots','/api/shipped','/api/artifacts','/api/ask'].includes(path))return route.fulfill({json:[]});
    if(path==='/api/bootstrap'){
      const response=await route.fetch();const d=await response.json();
      d.sessions=[];d.sessionPins=[];d.users=[{name:'Demo',email:'demo@example.com'}];d.repos=[{name:'demo',cwd:'/home/dev/projects/demo',project:'demo',custom:true}];d.auto={...d.auto,agents:[],findings:[]};d.settings={...d.settings,machineName:'Drawer demo',customInstructions:'',folderOrder:[],hiddenFolders:[]};
      d.viewer={managed:false};return route.fulfill({json:d});
    }
    return route.continue();
  });
}

async function swipe(page,from,to){
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x,y:from.y}]});
 for(let i=1;i<=16;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/16,y:from.y+(to.y-from.y)*i/16}]});await page.waitForTimeout(20)}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(1100);await cdp.detach();
}
(async()=>{
 const browser=await chromium.launch(launch);
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${baseURL}/scripts/drawer-check.html`);
 await page.getByRole('button',{name:'Snap points',exact:true}).click();await page.waitForTimeout(800);
 const sheet=page.locator('[data-slot="drawer-content"]');let box=await sheet.boundingBox();console.log('snap initial',box);assert(Math.abs(box.y-604)<20);
 await swipe(page,{x:195,y:620},{x:195,y:230});box=await sheet.boundingBox();console.log('snap expanded',box);assert(box.y<300);
 await page.getByRole('button',{name:'Open nested menu'}).click();await page.waitForTimeout(300);
 const menu=page.getByRole('menuitem',{name:'Choose Codex'});await menu.focus();assert(await menu.evaluate(e=>document.activeElement===e));await page.keyboard.press('Enter');await page.waitForTimeout(300);assert((await page.locator('body').innerText()).includes('Selection: Codex'));assert(await page.getByRole('dialog',{name:'Snap point sheet'}).isVisible());console.log('PASS nested menu focus and action');
 await page.getByRole('button',{name:'Open child sheet'}).click();await page.waitForTimeout(600);assert(await page.getByRole('dialog',{name:'Child sheet'}).isVisible());await page.keyboard.press('Escape');await page.waitForTimeout(800);assert.equal(await page.getByRole('dialog',{name:'Child sheet'}).count(),0);assert(await page.getByRole('dialog',{name:'Snap point sheet'}).isVisible());console.log('PASS child dismissal keeps parent');
 await page.getByRole('button',{name:'Close snap sheet'}).click();await page.waitForTimeout(800);assert.equal(await page.getByRole('dialog').count(),0);
 await page.getByRole('button',{name:'Protected sheet',exact:true}).click();await page.waitForTimeout(700);await page.keyboard.press('Escape');await page.mouse.click(200,100);await page.waitForTimeout(500);assert(await page.getByRole('dialog',{name:'Protected sheet'}).isVisible());await page.getByRole('button',{name:'Confirm close'}).click();await page.waitForTimeout(600);console.log('PASS protected sheet');
 await page.getByRole('button',{name:'Open updates'}).click();await page.waitForTimeout(700);const update=page.getByRole('dialog',{name:'Updates'});console.log('updates box',await update.boundingBox());await page.getByRole('button',{name:'Update 30',exact:true}).scrollIntoViewIfNeeded();assert(await page.getByRole('button',{name:'Update 30',exact:true}).isVisible());await page.keyboard.press('Escape');await page.waitForTimeout(700);console.log('PASS long updates scroll');
 await page.getByRole('button',{name:'Responsive drawer',exact:true}).click();await page.waitForTimeout(700);await page.getByRole('textbox',{name:'Search'}).fill('drawer');assert.equal(await sheet.getAttribute('data-paged'),'true');await page.getByRole('button',{name:'Close responsive drawer'}).click();await page.waitForTimeout(700);console.log('PASS mobile input expansion');
 await page.setViewportSize({width:1280,height:900});await page.getByRole('button',{name:'Responsive drawer',exact:true}).click();await page.waitForTimeout(700);assert.equal(await page.locator('[data-sheet-scroll]').count(),0);assert(await page.getByRole('dialog',{name:'Responsive drawer'}).isVisible());await page.keyboard.press('Escape');await page.waitForTimeout(300);console.log('PASS desktop centered dialog');
 assert.deepEqual(errors,[]);await context.close();
 const appContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const app=await appContext.newPage();await fixture(app);await app.goto(baseURL);await app.waitForTimeout(2000);
 await app.getByTestId('side-nav-button').click();await app.waitForTimeout(800);await swipe(app,{x:260,y:520},{x:5,y:520});assert.equal(await app.getByRole('dialog',{name:'Navigation'}).count(),0);console.log('PASS app navigation touch dismissal');
 await app.getByRole('button',{name:/Agent:.*Swipe/}).click();await app.waitForTimeout(700);await swipe(app,{x:195,y:588},{x:195,y:828});assert.equal(await app.locator('[data-slot="agent-setup-sheet"]').count(),0);console.log('PASS app agent touch dismissal');
 await appContext.close();await browser.close();console.log('ALL BROWSER CHECKS PASSED');
})().catch(e=>{console.error(e);process.exit(1)});
