// SharkLeash Best Beaches: scores every beach for tonight's 4-10 PM window and writes data/best-beaches.json
// Runs on GitHub Actions on a schedule. Data: NWS hourly forecast, NOAA NDBC buoys and MUR satellite water temp (via CoastWatch ERDDAP).
const fs = require('fs');
var SPX={sb:{n:'Sandbar',t:[58,82]},st:{n:'Sand tiger',t:[55,76]},du:{n:'Dusky',t:[62,80]},bt:{n:'Blacktip',t:[68,86]},sp:{n:'Spinner',t:[68,86]},
  sn:{n:'Atlantic sharpnose',t:[66,88]},bo:{n:'Bonnethead',t:[68,90]},ft:{n:'Finetooth',t:[70,88]},bu:{n:'Bull',t:[70,92]},le:{n:'Lemon',t:[70,90]},
  ti:{n:'Tiger',t:[72,90]},nu:{n:'Nurse',t:[72,90]},sh:{n:'Scalloped hammerhead',t:[72,88]},gh:{n:'Great hammerhead',t:[72,88]},
  sm:{n:'Smooth dogfish',t:[50,72]},sd:{n:'Spiny dogfish',t:[40,64]}};
var PROT_ALL=['sb','st','du'],PROT_ST={FL:['le','ti','sh','gh']};
// Beaches, depth, species tables and drone-ban states come from the shared data file (edit them there, not here):
const DATA_URL='https://raw.githubusercontent.com/SharkLeashDevelopment/sharkleash-data/main/shark-data.json';
var SPOTS=[],SPM={},DEEP=[],BAN={};
async function loadShared(){var j=null;for(let k=0;k<4&&!j;k++){try{const r=await fetch(DATA_URL+'?t='+Date.now());if(r.ok)j=await r.json();}catch(e){}if(!j)await sleep(2000);}
  if(!j||!Array.isArray(j.beaches)||!j.beaches.length){console.error('Could not load shark-data.json; keeping the previous file.');process.exit(1);}
  var C={high:'h',medium:'m',low:'l',inlet:'i'},f=v=>v==null?'':String(v).replace(/^>\s*/,'+');
  SPOTS=j.beaches.map(b=>[b.name+', '+b.state,b.lat,b.lon]);
  DEEP=j.beaches.map(b=>{var d=b.depth||{};return {d10:f(d.to10ftYd),c:C[d.confidence]||'m'};});
  SPM=j.speciesByMonth||{};
  PARK={};j.beaches.forEach(b=>{if(b.noDrones)PARK[b.name+', '+b.state]=b.noDrones;});
  if(!Object.keys(PARK).length){console.error('No no-drone parks in shark-data.json (old copy?); keeping the previous file.');process.exit(1);}
  BAN={};(j.states||[]).forEach(s=>{if(s.drone&&s.drone.status==='ban')BAN[s.ab]=1;});
  console.log('Loaded '+SPOTS.length+' beaches ('+Object.keys(PARK).length+' no-drone parks), '+Object.keys(SPM).length+' species tables; drone bans: '+Object.keys(BAN).join(', '));}
var PARK={};
const UA={'User-Agent':'SharkLeash Best Beaches (sharkleashfishing.com)','Accept':'application/geo+json'};
const DIRS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const TZ='America/New_York';
function km(a,b,c,d){var r=Math.PI/180,x=Math.sin((c-a)*r/2),y=Math.sin((d-b)*r/2);return 12742*Math.asin(Math.sqrt(x*x+Math.cos(a*r)*Math.cos(c*r)*y*y));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getJ(u,h,t=4){var why='';for(let k=0;k<t;k++){try{const r=await fetch(u,{headers:h||UA,signal:AbortSignal.timeout(45000)});if(r.ok)return await r.json();why='HTTP '+r.status;}catch(e){why=e.message;}await sleep(1500*(k+1));}throw new Error(why||'failed');}
function st(s){var m=/,\s*([A-Z]{2})$/.exec(s[0]);return m?m[1]:'';}
function hourNY(d){return +new Intl.DateTimeFormat('en-US',{hour:'numeric',hour12:false,timeZone:TZ}).format(d)%24;}
async function buoys(){var q=['station,latitude,longitude,time,WVHT,WTMP','time>=now-6hours','latitude>=24','latitude<=45.5','longitude>=-82.5','longitude<=-66','orderByMax("station,time")'].map(encodeURIComponent).join('&');
  try{var j=await getJ('https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.json?'+q,{'User-Agent':UA['User-Agent']});var c=j.table.columnNames,I=n=>c.indexOf(n);return j.table.rows.map(r=>({lat:r[I('latitude')],lon:r[I('longitude')],wv:r[I('WVHT')],wt:r[I('WTMP')]}));}catch(e){console.log('CoastWatch buoys failed ('+e.message+'); trying NDBC latest observations');return await ndbcLatest();}}
async function ndbcLatest(){try{var r=await fetch('https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt',{headers:{'User-Agent':UA['User-Agent']},signal:AbortSignal.timeout(45000)});if(!r.ok)throw new Error('HTTP '+r.status);
  var L=(await r.text()).split('\n'),h=L[0].replace('#','').trim().split(/\s+/),iA=h.indexOf('LAT'),iO=h.indexOf('LON'),iW=h.indexOf('WVHT'),iT=h.indexOf('WTMP'),n=v=>v==null||v==='MM'?null:+v;
  var out=L.filter(l=>l&&l[0]!=='#').map(l=>l.trim().split(/\s+/)).filter(a=>+a[iA]>=24&&+a[iA]<=45.5&&+a[iO]>=-82.5&&+a[iO]<=-66).map(a=>({lat:+a[iA],lon:+a[iO],wv:n(a[iW]),wt:n(a[iT])}));
  console.log('NDBC latest observations: '+out.length+' stations');return out;}catch(e){console.log('NDBC latest observations failed ('+e.message+')');return [];}}
async function sat(){var q='analysed_sst[(last)][(24.4):20:(45)][(-82):20:(-66.5)]';
  try{var j=await getJ('https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41F.json?'+encodeURIComponent(q),{'User-Agent':UA['User-Agent']});var c=j.table.columnNames,I=n=>c.indexOf(n);return j.table.rows.filter(r=>r[I('analysed_sst')]!=null).map(r=>({lat:r[I('latitude')],lon:r[I('longitude')],f:r[I('analysed_sst')]}));}catch(e){console.log('Satellite water temp failed ('+e.message+')');return [];}}
function near(list,lat,lon,maxKm,ok){var b=null,bd=1e9;list.forEach(p=>{if(!ok(p))return;var d=km(lat,lon,p.lat,p.lon);if(d<bd){bd=d;b=p;}});return bd<=maxKm?b:null;}
let PTS={};try{PTS=JSON.parse(fs.readFileSync('data/points.json','utf8'));}catch(e){}
async function wind(s){var k=s[1]+','+s[2],h=PTS[k];
  if(!h){var j=await getJ('https://api.weather.gov/points/'+s[1].toFixed(4)+','+s[2].toFixed(4));h=j.properties.forecastHourly;PTS[k]=h;}
  var f=await getJ(h),P=f.properties.periods,now=Date.now(),i0=-1;
  for(var i=0;i<P.length;i++){var t=new Date(P[i].startTime);if(t.getTime()>=now-36e5&&hourNY(t)>=16){i0=i;break;}}if(i0<0)i0=0;
  var W=P.slice(i0,i0+6),sp=W.map(p=>Math.max.apply(null,(String(p.windSpeed).match(/\d+/g)||[0]).map(Number))),avg=sp.reduce((a,b)=>a+b,0)/sp.length;
  var A=P.slice(i0,i0+36),t0=A[0].temperature,n=0;A.forEach(p=>{var d=DIRS.indexOf(p.windDirection);if((d>=13||d<=2)&&t0-p.temperature>=8)n++;});
  var before=P.slice(i0,i0+4).every(p=>{var d=DIRS.indexOf(p.windDirection);return d>=5&&d<=11;});
  return {avg:Math.round(avg),dir:W[0].windDirection,front:n>=2&&before,start:W[0].startTime};}
function lv(code,s,MO){var rows=SPM[st(s)]||[];for(var i=0;i<rows.length;i++)if(rows[i][0]===code){var P=rows[i][1];if(code==='bu'&&st(s)==='FL'&&s[1]<27.6)P='222333333222';return +P.charAt(MO);}return 0;}
function score(s,w,wv,wt,dp,MO){var b={};
  var v=w?w.avg:null;b.wind=v===null?10:v<5?10+3*v:v<=12?25:v>=29?0:Math.round(25*(29-v)/17);
  b.waves=wv==null?8:wv<1?9:wv<=3?15:wv<=5?Math.round(15-5*(wv-3)):wv<=6?3:0;
  b.temp=wt==null?8:(wt>=66&&wt<=82)?20:Math.max(0,Math.round(20-2*(wt<66?66-wt:wt-82)));
  var sum=0,list=[];(SPM[st(s)]||[]).forEach(r=>{var l=lv(r[0],s,MO),sp=SPX[r[0]];if(!l)return;var fit=wt==null||(wt>=sp.t[0]&&wt<=sp.t[1]);if(!fit)return;sum+=l===3?3:l===2?2:0.5;if(l>=2)list.push(sp.n);});
  b.sharks=Math.round(25*Math.min(1,sum/10));
  var d=dp?dp.d10:'';b.deep=dp&&dp.c==='i'?12:!d?7:d.charAt(0)==='+'||+d>800?2:+d<=150?15:Math.round(15-10*Math.min(1,(+d-150)/450));
  b.front=w&&w.front?5:0;
  return {b:b,tot:b.wind+b.waves+b.temp+b.sharks+b.deep+b.front,list:list};}
(async function(){
  await loadShared();
  var MO=+new Intl.DateTimeFormat('en-US',{month:'numeric',timeZone:TZ}).format(new Date())-1;
  var [B,S]=await Promise.all([buoys(),sat()]);
  /* if NOAA buoys or satellite are down, reuse the last good surf / water temp (up to 12 hours old) instead of scoring blind */
  var PREV={},PREV_ENV=null;try{var lg=JSON.parse(fs.readFileSync('data/last-good-readings.json','utf8'));PREV_ENV=lg.at;if(Date.now()-new Date(lg.at).getTime()<12*36e5)PREV=lg.beaches||{};}catch(e){}
  var noWave=!B.some(p=>p.wv!=null&&!isNaN(p.wv)),noTemp=!B.some(p=>p.wt!=null&&!isNaN(p.wt))&&!S.length;
  if(noWave||noTemp)console.log('NOAA data missing (waves: '+(noWave?'no':'ok')+', water temp: '+(noTemp?'no':'ok')+'); reusing last good values for '+Object.keys(PREV).length+' beaches');
  var W=new Array(SPOTS.length),i=0,fails=0;
  async function worker(){while(i<SPOTS.length){var k=i++;try{W[k]=await wind(SPOTS[k]);}catch(e){W[k]=null;fails++;}await sleep(250);}}
  await Promise.all([worker(),worker(),worker(),worker()]);
  var R=SPOTS.map((s,i)=>{var bw=near(B,s[1],s[2],80,p=>p.wv!=null&&!isNaN(p.wv)),bt=near(B,s[1],s[2],40,p=>p.wt!=null&&!isNaN(p.wt));
    var wt=bt?bt.wt*9/5+32:(()=>{var x=near(S,s[1],s[2],40,()=>true);return x?x.f:null;})(),wv=bw?bw.wv*3.28084:null;if(wv==null&&noWave&&PREV[s[0]])wv=PREV[s[0]].wv;if(wt==null&&noTemp&&PREV[s[0]])wt=PREV[s[0]].wt;var sc=score(s,W[i],wv,wt,DEEP[i],MO),stt=st(s);
    return {name:s[0],lat:s[1],lon:s[2],w:W[i],wv:wv==null?null:Math.round(wv*10)/10,wt:wt==null?null:Math.round(wt*10)/10,d10:DEEP[i].d10,dc:DEEP[i].c,score:sc.tot,parts:sc.b,sharks:sc.list,
      flag:BAN[stt]?'drone drops banned in '+stt:PARK[s[0]]?'no drones ('+PARK[s[0]]+')':''};});
  if(fails>40){console.error('Too many forecast failures ('+fails+'); keeping the previous file.');process.exit(1);}
  fs.mkdirSync('data',{recursive:true});
  fs.writeFileSync('data/points.json',JSON.stringify(PTS));
  if(!noWave&&!noTemp){var LG={};R.forEach(r=>{LG[r.name]={wv:r.wv,wt:r.wt};});fs.writeFileSync('data/last-good-readings.json',JSON.stringify({at:new Date().toISOString(),beaches:LG}));}
  fs.writeFileSync('data/best-beaches.json',JSON.stringify({updated:new Date().toISOString(),envUpdated:(noWave||noTemp)?PREV_ENV:new Date().toISOString(),month:MO,windowStart:(R.find(r=>r.w)||{w:{}}).w.start||null,beaches:R}));
  var top=R.filter(r=>!r.flag).sort((a,b)=>b.score-a.score).slice(0,5);
  try{require('./images.js')(top,'post');console.log('Post images drawn');}catch(e){console.log('Post images skipped: '+e.message);}
  console.log('Top 5:');top.forEach((r,i)=>console.log((i+1)+'. '+r.name+' '+r.score));console.log('Forecast failures: '+fails);
})();
