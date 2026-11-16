const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:460,height:560,show:true,transparent:true,webPreferences:{preload:path.join(__dirname,'_qa-preload.js'),contextIsolation:true,sandbox:false}});
 await win.loadFile(path.join(__dirname,'dist/renderer/index.html'));
 const js=c=>win.webContents.executeJavaScript(c);
 await js(`window.probe.emit('card', { lastTab: 'controls', notices: [], clips: [], sites: [], shelf: [], tasks: [], greetingSeen: true }); true`);
 await js(`window.probe.emit('settings', {"surface":"Liquid glass","islandContent":"clock-robot","catIdleCenter":true,"catGreeting":false,"barOrder":["clock","cat","battery","media","mic"],"visibleTabs":["controls"]}); true`);
 await js(`window.probe.emit('status', {"state":"pill","surface":"Liquid glass","glassLevel":55,"accent":"#e9eef7","cardWidth":420,"visibleTabs":["controls"],"miniMode":"clock","media":false,"meeting":false}); true`);
 await sleep(300);
 for (const idle of [false,true,false,true]) {
  await js(`window.probe.emit('robot', { idle: ${idle}, batteryPercent: 80, charging: false, cursorDx: 0 }); true`);
  await sleep(220);
  console.log(idle, await js(`(() => { const i=document.getElementById('island'); const s=document.querySelector('#pillCatSlot'); const b=s.getBoundingClientRect(); return JSON.stringify({pos:i.dataset.catPos,rail:i.dataset.catRail,idle:i.dataset.catIdle,greeting:i.dataset.greeting,x:Math.round(b.x),w:Math.round(b.width)}); })()`));
 }
 win.destroy(); app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
