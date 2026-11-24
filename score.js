// SharkLeash Best Beaches: scores every beach for tonight's drop window (2 hours before sunset to 4 hours after, each beach's own sunset) and writes data/best-beaches.json
// Runs every 2 hours. During the window it scores what's left of tonight; once it ends it moves to tomorrow evening.
// Morning runs (4-8 AM Eastern) also score this morning's 5-11 AM window: data/best-mornings.json + post images in data/post/am.
// Runs on GitHub Actions on a schedule. Data: NWS hourly forecast, NOAA NDBC buoys and MUR satellite water temp (via CoastWatch ERDDAP).
const fs = require('fs');
var SPX={sk:{n:'Silky',t:[70,88]},bn:{n:'Blacknose',t:[70,88]},sb:{n:'Sandbar',t:[58,82]},st:{n:'Sand tiger',t:[55,76]},du:{n:'Dusky',t:[62,80]},bt:{n:'Blacktip',t:[68,86]},sp:{n:'Spinner',t:[68,86]},
  sn:{n:'Atlantic sharpnose',t:[66,88]},bo:{n:'Bonnethead',t:[68,90]},ft:{n:'Finetooth',t:[70,88]},bu:{n:'Bull',t:[70,92]},le:{n:'Lemon',t:[70,90]},
  ti:{n:'Tiger',t:[72,90]},nu:{n:'Nurse',t:[72,90]},sh:{n:'Scalloped hammerhead',t:[72,88]},gh:{n:'Great hammerhead',t:[72,88]},
  sm:{n:'Smooth dogfish',t:[50,72]},sd:{n:'Spiny dogfish',t:[40,64]}};
var PROT_ALL=['sb','st','du'],PROT_ST={FL:['le','ti','sh','gh']};
// Beaches, depth, species tables and drone-ban states come from the shared data file (edit them there, not here):
const DATA_URL='https://raw.githubusercontent.com/SharkLeashDevelopment/sharkleash-data/main/shark-data.json';
var SPOTS=[],IDS=[],SPM={},DEEP=[],BAN={},REG=[],LBAN=[],SEAS=[],CLB=[],BAIT={},BAITN={};
/* a local ban with banMonths (1-12, e.g. [5,6,7,8,9]) only applies in those months, Eastern time */
function banOn(b){if(!b||!b.localBan)return false;var m=b.banMonths;if(!m||!m.length)return true;var mo=+new Intl.DateTimeFormat('en-US',{month:'numeric',timeZone:'America/New_York'}).format(new Date());return m.indexOf(mo)>=0;}

const {updateClarity}=require('./clarity.js');
async function loadShared(){var j=null;for(let k=0;k<4&&!j;k++){try{const r=await fetch(DATA_URL+'?t='+Date.now());if(r.ok)j=await r.json();}catch(e){}if(!j)await sleep(2000);}
  if(!j||!Array.isArray(j.beaches)||!j.beaches.length){console.error('Could not load shark-data.json; keeping the previous file.');process.exit(1);}
  var C={high:'h',medium:'m',low:'l',inlet:'i'},f=v=>v==null?'':String(v).replace(/^>\s*/,'+');
  SPOTS=j.beaches.map(b=>[b.name+', '+b.state,b.lat,b.lon]);
  /* permanent beach ids (shark-data.json "id"); a beach without one falls back to its name-state slug */
  IDS=j.beaches.map(b=>b.id||String(b.name+', '+b.state).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''));
  DEEP=j.beaches.map(b=>{var d=b.depth||{};return {d10:f(d.to10ftYd),c:C[d.confidence]||'m'};});
  SPM=Object.assign({},j.speciesByMonth||{},j.speciesByRegion||{});
  REG=j.beaches.map(b=>b.speciesRegion&&SPM[b.speciesRegion]?b.speciesRegion:b.state);
  /* seasonal bans out of season don't flag the beach; the rule rides along as "seasonal" so it can still be shown */
  LBAN=j.beaches.map(b=>banOn(b)?b.localBan:'');SEAS=j.beaches.map(b=>b.localBan&&!banOn(b)?b.localBan:'');
  CLB=j.beaches.map(b=>({faces:b.faces,clarityBase:b.clarityBase||0}));
  PARK={};PRIV={};j.beaches.forEach(b=>{var k=b.name+', '+b.state;if(b.noDrones)PARK[k]=b.noDrones;if(b.privateLaunch)PRIV[k]=1;});
  if(!Object.keys(PARK).length){console.error('No no-drone parks in shark-data.json (old copy?); keeping the previous file.');process.exit(1);}
  if(j.protected)PROT_ST=j.protected;
  BAIT=j.baitByRegion||{};BAITN={};(j.baitSpecies||[]).forEach(b=>{BAITN[b.code]=b.short||b.name;});
  BAN={};(j.states||[]).forEach(s=>{if(s.drone&&s.drone.status==='ban')BAN[s.ab]=1;});
  console.log('Loaded '+SPOTS.length+' beaches ('+Object.keys(PARK).length+' no-drone parks), '+Object.keys(SPM).length+' species tables; drone bans: '+Object.keys(BAN).join(', '));}
var PARK={},PRIV={};
const UA={'User-Agent':'SharkLeash Best Beaches (sharkleashfishing.com)','Accept':'application/geo+json'};
const DIRS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const TZ='America/New_York';
function km(a,b,c,d){var r=Math.PI/180,x=Math.sin((c-a)*r/2),y=Math.sin((d-b)*r/2);return 12742*Math.asin(Math.sqrt(x*x+Math.cos(a*r)*Math.cos(c*r)*y*y));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
/* angler reports (same Apps Script as the clarity buttons) and NOAA tide stations */
const REPORT_URL='https://script.google.com/macros/s/AKfycbzO-9-krA8DIvmFRk1N-uIw6rYV1O75beHxxIi9IRthrOnoGBBSci6MONJU9apbPecACA/exec';
const TIDE_URL='https://raw.githubusercontent.com/SharkLeashDevelopment/sharkleash-data/main/tide-stations.json';
const NOFLY_MPH=25,NOFLY_CAP=40; /* evening average wind at or over this: "too windy to fly", total capped */
/* "Bait showing tonight?" reports from the last 24 h: {"Name, ST":{counts:{yes,no},trusted}} */
async function baitReports(){try{var r=await fetch(REPORT_URL+'?type=bait',{signal:AbortSignal.timeout(30000)});var j=await r.json();return j&&j.ok?j.beaches||{}:{};}catch(e){console.log('Bait reports unavailable: '+e.message);return {};}}
/* high tide inside the evening window: nearest NOAA station within 30 km, hi/lo predictions */
var TST=[],TSTX=[],TCACHE={};
/* red tide: FWC's last 8 days of Karenia brevis samples (Florida only). A beach gets a warning when a medium or high sample is within RT_MI miles. */
const HAB_URL='https://gis.myfwc.com/mapping/rest/services/Projects_FWC/HAB_forDEP_Dashboard/MapServer/0/query?where=1%3D1&outFields=SampleDate_t,LOCATION,LATITUDE,LONGITUDE,Abundance&returnGeometry=false&resultRecordCount=2000&f=json';
const RT_MI=10,RT_LV=['background','very low','low','medium','high'];
function rtLevel(a){a=String(a||'').toLowerCase();return a.startsWith('high')?4:a.startsWith('medium')?3:a.startsWith('very low')?1:a.startsWith('low')?2:0;}
async function redTide(){try{var j=await getJ(HAB_URL,UA,3);var out=(j.features||[]).map(f=>f.attributes||{}).filter(a=>a.LATITUDE!=null&&a.LONGITUDE!=null)
  .map(a=>({lat:+a.LATITUDE,lon:+a.LONGITUDE,lv:rtLevel(a.Abundance),where:a.LOCATION||'',date:a.SampleDate_t||''}));
  console.log('Red tide: '+out.length+' FWC samples, '+out.filter(x=>x.lv>=3).length+' medium or high');return out;}catch(e){console.log('Red tide data unavailable: '+e.message);return null;}}
function rtNear(H,lat,lon){if(!H)return undefined;var best=null;H.forEach(h=>{if(h.lv<3)return;var mi=km(lat,lon,h.lat,h.lon)*0.621371;if(mi>RT_MI)return;
  if(!best||h.lv>best.lv||(h.lv===best.lv&&mi<best.mi))best={lv:h.lv,mi:mi,where:h.where,date:h.date};});
  return best?{level:RT_LV[best.lv],mi:Math.round(best.mi),where:best.where,date:best.date}:undefined;}
async function loadTides(){try{var r=await fetch(TIDE_URL);TST=((await r.json()).stations||[]).map(x=>({id:x[0],name:x[1],lat:x[2],lon:x[3]}));}catch(e){TST=[];console.log('Tide stations unavailable');}
  /* fallback: tide-stations.json is Atlantic only, so the whole Gulf (and a few Atlantic spots) had no station and never got the tide bonus.
     A beach with no listed station within 30 km uses the nearest NOAA prediction station instead; beaches with a listed station keep it. */
  try{var g=await getJ('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions',{'User-Agent':UA['User-Agent']},3),have={};TST.forEach(t=>{have[t.id]=1;});
    TSTX=(g.stations||[]).map(x=>({id:String(x.id),name:x.name,lat:+x.lat,lon:+x.lng})).filter(x=>!have[x.id]&&x.lat>=24&&x.lat<=45.5&&x.lon>=-98&&x.lon<=-66);
    console.log('Tide stations: '+TST.length+' listed + '+TSTX.length+' NOAA fallback');}catch(e){TSTX=[];console.log('NOAA tide station list unavailable: '+e.message);}}
async function tideHi(st,startIso,hrs){var d=new Date(startIso),key=st.id+'_'+d.toISOString().slice(0,10);
  if(!(key in TCACHE)){var bd=new Date(d.getTime()-6*36e5).toISOString().slice(0,10).replace(/-/g,'');
    TCACHE[key]=getJ('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&interval=hilo&datum=MLLW&time_zone=gmt&units=english&format=json&application=SharkLeash&range=36&station='+st.id+'&begin_date='+bd,{'User-Agent':UA['User-Agent']},2)
      .then(j=>(j.predictions||[]).map(p=>({t:Date.parse(p.t.replace(' ','T')+'Z'),type:p.type,v:+p.v}))).catch(()=>null);}
  var P=await TCACHE[key];if(!P)return null;var t0=d.getTime(),t1=t0+(hrs||6)*36e5;
  var hi=P.find(p=>p.type==='H'&&p.t>=t0&&p.t<=t1);return {station:st.name,high:hi?new Date(hi.t).toISOString():null};}
async function getJ(u,h,t=4){var why='';for(let k=0;k<t;k++){try{const r=await fetch(u,{headers:h||UA,signal:AbortSignal.timeout(45000)});if(r.ok)return await r.json();why='HTTP '+r.status;}catch(e){why=e.message;}await sleep(1500*(k+1));}throw new Error(why||'failed');}
function st(s){var m=/,\s*([A-Z]{2})$/.exec(s[0]);return m?m[1]:'';}
function hourNY(d){return +new Intl.DateTimeFormat('en-US',{hour:'numeric',hour12:false,timeZone:TZ}).format(d)%24;}
async function buoys(){var q=['station,latitude,longitude,time,WVHT,DPD,WTMP','time>=now-6hours','latitude>=24','latitude<=45.5','longitude>=-98','longitude<=-66','orderByMax("station,time")'].map(encodeURIComponent).join('&');
  try{var j=await getJ('https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.json?'+q,{'User-Agent':UA['User-Agent']});var c=j.table.columnNames,I=n=>c.indexOf(n);return j.table.rows.map(r=>({id:r[I('station')],lat:r[I('latitude')],lon:r[I('longitude')],wv:r[I('WVHT')],wp:r[I('DPD')],wt:r[I('WTMP')]}));}catch(e){console.log('CoastWatch buoys failed ('+e.message+'); trying NDBC latest observations');return await ndbcLatest();}}
async function ndbcLatest(){try{var r=await fetch('https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt',{headers:{'User-Agent':UA['User-Agent']},signal:AbortSignal.timeout(45000)});if(!r.ok)throw new Error('HTTP '+r.status);
  var L=(await r.text()).split('\n'),h=L[0].replace('#','').trim().split(/\s+/),iA=h.indexOf('LAT'),iO=h.indexOf('LON'),iW=h.indexOf('WVHT'),iP=h.indexOf('DPD'),iT=h.indexOf('WTMP'),n=v=>v==null||v==='MM'?null:+v;
  var out=L.filter(l=>l&&l[0]!=='#').map(l=>l.trim().split(/\s+/)).filter(a=>+a[iA]>=24&&+a[iA]<=45.5&&+a[iO]>=-98&&+a[iO]<=-66).map(a=>({id:a[0],lat:+a[iA],lon:+a[iO],wv:n(a[iW]),wp:iP<0?null:n(a[iP]),wt:n(a[iT])}));
  console.log('NDBC latest observations: '+out.length+' stations');return out;}catch(e){console.log('NDBC latest observations failed ('+e.message+')');return [];}}
async function sat(){var q='analysed_sst[(last)][(24.4):20:(45)][(-98):20:(-66.5)]';
  try{var j=await getJ('https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41F.json?'+encodeURIComponent(q),{'User-Agent':UA['User-Agent']});var c=j.table.columnNames,I=n=>c.indexOf(n);return j.table.rows.filter(r=>r[I('analysed_sst')]!=null).map(r=>({lat:r[I('latitude')],lon:r[I('longitude')],f:r[I('analysed_sst')]}));}catch(e){console.log('Satellite water temp failed ('+e.message+')');return [];}}
/* backup waves where no buoy is in range: NOAA WaveWatch III model, 0.5 degree grid, nearest hour */
async function ww3(){var t=new Date();t.setUTCMinutes(0,0,0);var T=t.toISOString().replace('.000','');
  /* upwell carries the current run (forecast days ahead); coastwatch's copy can lag a day, so it is only the backup */
  var tries=[['https://upwell.pfeg.noaa.gov','('+T+')'],['https://coastwatch.pfeg.noaa.gov','(last)']];
  for(var k=0;k<tries.length;k++){var box='['+tries[k][1]+'][(0.0)][(24):1:(45.5)][(262):1:(294)]',q='Thgt'+box+',Tper'+box;
    try{var j=await getJ(tries[k][0]+'/erddap/griddap/NWW3_Global_Best.json?'+encodeURIComponent(q),{'User-Agent':UA['User-Agent']},2);var c=j.table.columnNames,I=n=>c.indexOf(n);
      var out=j.table.rows.filter(r=>r[I('Thgt')]!=null&&!isNaN(r[I('Thgt')])).map(r=>({lat:r[I('latitude')],lon:r[I('longitude')]-360,wv:r[I('Thgt')],wp:r[I('Tper')]}));
      var tm=j.table.rows.length?j.table.rows[0][I('time')]:'?';
      console.log('Wave model: '+out.length+' ocean cells from '+tries[k][0].split('//')[1].split('.')[0]+' ('+tm+')');if(out.length)return out;}
    catch(e){console.log('Wave model failed on '+tries[k][0].split('//')[1].split('.')[0]+' ('+e.message+')');}}
  return [];}
/* a station counts for a beach only if it is out to sea from it: within the angle below of the way the beach faces, or right at the beach (a pier).
   This keeps harbor, bay and sound sensors behind or beside a beach from standing in for the ocean. */
function brg(a,b,c,d){var r=Math.PI/180,y=Math.sin((d-b)*r)*Math.cos(c*r),x=Math.cos(a*r)*Math.sin(c*r)-Math.sin(a*r)*Math.cos(c*r)*Math.cos((d-b)*r);return (Math.atan2(y,x)/r+360)%360;}
/* offshore buoys (5-digit ids) may sit up or down the coast, so they get 110 degrees; shore stations (letter ids, often in harbors) get 75. Ocean piers are allowed by name. */
var OCEAN_PIERS={LKWF1:1,MROS1:1,JMPN7:1,DUKN7:1};
function seaward(lat,lon,faces,p){if(faces==null||OCEAN_PIERS[p.id])return true;if(km(lat,lon,p.lat,p.lon)<=3)return true;var d=Math.abs(brg(lat,lon,p.lat,p.lon)-faces)%360;if(d>180)d=360-d;return d<=(/^\d{5}$/.test(String(p.id))?110:75);}
function near(list,lat,lon,maxKm,ok){var b=null,bd=1e9;list.forEach(p=>{if(!ok(p))return;var d=km(lat,lon,p.lat,p.lon);if(d<bd){bd=d;b=p;}});return bd<=maxKm?b:null;}
/* morning runs: 4-8 AM Eastern (the 5 and 7 AM runs in winter, 4, 6 and 8 AM in summer) */
const AM_RUN=(function(){var h=hourNY(new Date());return h>=4&&h<=8;})()||process.env.AM_RUN==='1';
let PTS={};try{PTS=JSON.parse(fs.readFileSync('data/points.json','utf8'));}catch(e){}
async function wind(s){var k=s[1]+','+s[2],h=PTS[k];
  if(!h){var j=await getJ('https://api.weather.gov/points/'+s[1].toFixed(4)+','+s[2].toFixed(4));h=j.properties.forecastHourly;PTS[k]=h;}
  var f=await getJ(h),P=f.properties.periods;
  var ev=eveWin(P,s[1],s[2]);if(AM_RUN)ev.am=win(P,5,11,false);return ev;}
/* sunset for a calendar date (NOAA approximation, within a minute or two); returns epoch ms */
function sunsetMs(y,m,d,lat,lon){var R=Math.PI/180,J=Date.UTC(y,m,d,12)/864e5+2440587.5,n=Math.round(J-2451545+0.0008-lon/360),
  Js=2451545+0.0009-lon/360+n,M=(357.5291+0.98560028*(Js-2451545))%360,C=1.9148*Math.sin(M*R)+0.02*Math.sin(2*M*R)+0.0003*Math.sin(3*M*R),L=(M+C+180+102.9372)%360,
  Jt=Js+0.0053*Math.sin(M*R)-0.0069*Math.sin(2*L*R),dec=Math.asin(Math.sin(L*R)*Math.sin(23.44*R)),
  w=Math.acos((Math.sin(-0.833*R)-Math.sin(lat*R)*Math.sin(dec))/(Math.cos(lat*R)*Math.cos(dec)))/R/360;return (Jt+w-2440587.5)*864e5;}
/* evening drop window: from the hour nearest 2 h before sunset, 6 hours (to about 4 h after sunset). Anglers set baits an hour or two before dark.
   Nov in Florida ~3-9 PM; June in NC ~6:30 PM-12:30 AM. Once tonight's window is over it moves to tomorrow's. */
const EVE_PRE=2,EVE_HRS=6;
function eveStart(lat,lon,now){var t=new Date(now);for(var k=-1;k<=3;k++){var d=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),t.getUTCDate()+k));
    var ss=sunsetMs(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),lat,lon),S=Math.round((ss-EVE_PRE*36e5)/36e5)*36e5;if(S+EVE_HRS*36e5>now)return S;}return null;}
function eveWin(P,lat,lon){var now=Date.now(),S=eveStart(lat,lon,now),i0=-1;
  if(S!=null)for(var i=0;i<P.length;i++){var t=Date.parse(P[i].startTime);if(t>=now-36e5&&t>=S&&t<S+EVE_HRS*36e5){i0=i;break;}}
  return win(P,16,22,true,i0);}
/* one 6-hour window from the hourly forecast: the evening (start index from eveWin; 4-10 PM local only if sunset can't be worked out) or morning 5-11 AM (h0=5), beach local time.
   The evening falls back to the first period if none is found (as before); the morning returns null instead. */
function win(P,h0,h1,fallback,i0){var now=Date.now();if(i0==null||i0<0)i0=-1;
  if(i0<0)for(var i=0;i<P.length;i++){var t=new Date(P[i].startTime);var hr=+String(P[i].startTime).slice(11,13);if(t.getTime()>=now-36e5&&hr>=h0&&hr<h1){i0=i;break;}}
  if(i0<0){if(!fallback)return null;i0=0;}
  /* evening: always 6 hours from the first window hour (unchanged); morning: only the hours left before 11 AM */
  var W=P.slice(i0,i0+(fallback?6:Math.max(1,Math.min(6,h1-+String(P[i0].startTime).slice(11,13)))));
  var sp=W.map(p=>Math.max.apply(null,(String(p.windSpeed).match(/\d+/g)||[0]).map(Number))),avg=sp.reduce((a,b)=>a+b,0)/sp.length;
  var A=P.slice(i0,i0+36),t0=A[0].temperature,n=0;A.forEach(p=>{var d=DIRS.indexOf(p.windDirection);if((d>=13||d<=2)&&t0-p.temperature>=8)n++;});
  var before=P.slice(i0,i0+4).every(p=>{var d=DIRS.indexOf(p.windDirection);return d>=5&&d<=11;});
  return {avg:Math.round(avg),dir:W[0].windDirection,front:n>=2&&before,start:W[0].startTime,hrs:fallback?undefined:W.length};}
function lv(code,s,MO,rk){var rows=SPM[rk]||[];for(var i=0;i<rows.length;i++)if(rows[i][0]===code){var P=rows[i][1];if(code==='bu'&&rk==='FL'&&s[1]<27.6)P='222333333222';return +P.charAt(MO);}return 0;}
function score(s,w,wv,wt,dp,MO,rk,tide,brep){var b={};rk=rk||st(s);
  var v=w?w.avg:null;b.wind=v===null?10:v<5?10+3*v:v<=12?25:v>=29?0:Math.round(25*(29-v)/17);
  b.waves=wv==null?8:wv<1?9:wv<=3?15:wv<=5?Math.round(15-5*(wv-3)):wv<=6?3:0;
  b.temp=wt==null?8:(wt>=66&&wt<=82)?20:Math.max(0,Math.round(20-2*(wt<66?66-wt:wt-82)));
  /* every species in its water temp range: common/peak (2-3) in list, peak first; occasional (1) in maybe; protected ones in rel */
  var sum=0,got=[],prot=PROT_ALL.concat(PROT_ST[st(s)]||[]);(SPM[rk]||[]).forEach((r,ix)=>{var l=lv(r[0],s,MO,rk),sp=SPX[r[0]];if(!l||!sp)return;var fit=wt==null||(wt>=sp.t[0]&&wt<=sp.t[1]);if(!fit)return;sum+=l===3?3:l===2?2:0.5;got.push({n:sp.n,l:l,ix:ix,p:prot.indexOf(r[0])>=0});});
  got.sort((a,b)=>b.l-a.l||a.ix-b.ix);var list=got.filter(g=>g.l>=2).map(g=>g.n),maybe=got.filter(g=>g.l===1).map(g=>g.n),rel=got.filter(g=>g.p).map(g=>g.n);
  /* bait running (baitByRegion): sharks 15 + bait 10 when bait data exists, else the old sharks 25. Bait is scaled by the temp score, so bait in cold water adds little. */
  var bt=BAIT[rk]||BAIT[st(s)],bsum=0,blist=[];
  if(bt){bt.forEach((r,ix)=>{var l=+r[1].charAt(MO);if(!l)return;bsum+=l===3?3:l===2?2:0.5;if(l>=2)blist.push({n:BAITN[r[0]]||r[0],l:l,ix:ix});});
    blist.sort((a,c)=>c.l-a.l||a.ix-c.ix);
    /* anglers override the bait calendar: two matching reports in 24 h (or one from a tester code) */
    var bf=Math.min(1,bsum/8),y=brep&&brep.counts?brep.counts.yes||0:0,nn=brep&&brep.counts?brep.counts.no||0:0;
    if((y>=2&&y>nn)||(brep&&brep.trusted==='yes'))bf=1;else if((nn>=2&&nn>y)||(brep&&brep.trusted==='no'))bf=0;
    b.sharks=Math.round(15*Math.min(1,sum/10));b.bait=Math.round(10*bf*b.temp/20);}
  else b.sharks=Math.round(25*Math.min(1,sum/10));
  var d=dp?dp.d10:'';b.deep=dp&&dp.c==='i'?12:!d?7:d.charAt(0)==='+'||+d>800?2:+d<=150?15:Math.round(15-10*Math.min(1,(+d-150)/450));
  b.front=w&&w.front?5:0;
  b.tide=tide&&tide.high?5:0; /* high tide inside the window: fishing the incoming */
  var tot=b.wind+b.waves+b.temp+b.sharks+(b.bait||0)+b.deep+b.front+b.tide;
  if(w&&w.avg>=NOFLY_MPH){b.nofly=1;tot=Math.min(tot,NOFLY_CAP);}
  return {b:b,tot:tot,list:list,maybe:maybe,rel:rel,bait:blist.map(x=>[x.n,x.l])};}
(async function(){
  await loadShared();
  var MO=+new Intl.DateTimeFormat('en-US',{month:'numeric',timeZone:TZ}).format(new Date())-1;
  var [B,S,M,BREP]=await Promise.all([buoys(),sat(),ww3(),baitReports(),loadTides()]);
  /* if NOAA buoys or satellite are down, reuse the last good surf / water temp (up to 12 hours old) instead of scoring blind */
  var PREV={},PREV_ENV=null,LGALL={},NOW=Date.now(),FRESH=t=>t&&NOW-new Date(t).getTime()<12*36e5;try{var lg=JSON.parse(fs.readFileSync('data/last-good-readings.json','utf8'));PREV_ENV=lg.at;LGALL=lg.beaches||{};
    /* per beach and per reading: a value counts as last good for 12 h from when it was measured (older files have no per-beach times, so they use the file time) */
    for(var k in LGALL){var e=LGALL[k],v={};if(e.wv!=null&&FRESH(e.wvAt||lg.at))v.wv=e.wv;if(e.wt!=null&&FRESH(e.wtAt||lg.at))v.wt=e.wt;PREV[k]=v;}}catch(e){}
  var noWave=!B.some(p=>p.wv!=null&&!isNaN(p.wv)),noTemp=!B.some(p=>p.wt!=null&&!isNaN(p.wt))&&!S.length;
  if(noWave||noTemp)console.log('NOAA data missing (waves: '+(noWave?'no':'ok')+', water temp: '+(noTemp?'no':'ok')+'); reusing last good values for '+Object.keys(PREV).length+' beaches');
  var W=new Array(SPOTS.length),AMW=new Array(SPOTS.length),i=0,fails=0;
  /* the morning window comes from the same forecast call; kept apart so best-beaches.json is unchanged */
  async function worker(){while(i<SPOTS.length){var k=i++;try{W[k]=await wind(SPOTS[k]);if(W[k]&&'am' in W[k]){AMW[k]=W[k].am;delete W[k].am;}}catch(e){W[k]=null;fails++;}await sleep(250);}}
  await Promise.all([worker(),worker(),worker(),worker()]);
  /* tides: one prediction call per station per night, shared by nearby beaches */
  var TD=new Array(SPOTS.length),j2=0,tN=0;
  async function tworker(){while(j2<SPOTS.length){var k=j2++,s=SPOTS[k];if(!W[k]||!TST.length)continue;var st0=near(TST,s[1],s[2],30,()=>true)||near(TSTX,s[1],s[2],30,()=>true);if(!st0)continue;
    var had=Object.keys(TCACHE).length;try{TD[k]=await tideHi(st0,W[k].start);}catch(e){}if(Object.keys(TCACHE).length>had)await sleep(150);}}
  await Promise.all([tworker(),tworker(),tworker(),tworker()]);TD.forEach(t=>{if(t)tN++;});
  console.log('Tides: '+tN+' beaches, '+Object.keys(TCACHE).length+' station lookups; bait reports for '+Object.keys(BREP).length+' beaches');
  var nSkip=0,nSat=0;
  var R=SPOTS.map((s,i)=>{var fc=CLB[i]&&CLB[i].faces,sw=p=>seaward(s[1],s[2],fc,p);
    var bw=near(B,s[1],s[2],80,p=>p.wv!=null&&!isNaN(p.wv)&&sw(p)),bt=near(B,s[1],s[2],40,p=>p.wt!=null&&!isNaN(p.wt)&&sw(p));
    if(!bt&&near(B,s[1],s[2],40,p=>p.wt!=null&&!isNaN(p.wt)))nSkip++;
    var sx=near(S,s[1],s[2],40,()=>true);if(bt&&sx&&Math.abs(bt.wt*9/5+32-sx.f)>6){bt=null;nSat++;}
    var wm=near(M,s[1],s[2],70,()=>true),wsrc=bw?'buoy':null;if(!bw&&wm)wsrc='model';
    var wp=bw&&bw.wp>0?bw.wp:wm&&wm.wp>0?wm.wp:null;var wt=bt?bt.wt*9/5+32:(sx?sx.f:null),wv=bw?bw.wv*3.28084:wm?wm.wv*3.28084:null;var pv=PREV[s[0]]||{},wvOld=false,wtOld=false;if(wv==null&&pv.wv!=null){wv=pv.wv;wvOld=true;}if(wt==null&&pv.wt!=null){wt=pv.wt;wtOld=true;}var sc=score(s,W[i],wv,wt,DEEP[i],MO,REG[i],TD[i],BREP[s[0]]),stt=st(s);
    return {name:s[0],id:IDS[i],lat:s[1],lon:s[2],w:W[i],wv:wv==null?null:Math.round(wv*10)/10,wt:wt==null?null:Math.round(wt*10)/10,d10:DEEP[i].d10,dc:DEEP[i].c,wp:wp,wsrc:wsrc,tsrc:bt?'buoy '+(bt.id||''):sx?'satellite':wtOld?'last good reading':null,wvOld:wvOld||undefined,score:sc.tot,raw:sc.tot,parts:sc.b,sharks:sc.list,maybe:sc.maybe,release:sc.rel,bait:sc.bait,tide:TD[i]||undefined,baitRep:BREP[s[0]]?BREP[s[0]].counts:undefined,baitTr:BREP[s[0]]&&BREP[s[0]].trusted||undefined,
      seasonal:SEAS[i]||undefined,flag:LBAN[i]?'shark fishing banned here ('+LBAN[i]+')':BAN[stt]?'drone drops banned in '+stt:PARK[s[0]]&&!PRIV[s[0]]?'no drones ('+PARK[s[0]]+')':'',note:!LBAN[i]&&!BAN[stt]&&PARK[s[0]]&&PRIV[s[0]]?'launch from private property only ('+PARK[s[0]]+')':''};});
  console.log('Water temp: '+nSkip+' beaches skipped a station behind or beside the beach; '+nSat+' buoy readings dropped for disagreeing with the satellite by more than 6F');
  /* water clarity outlook: rolling murk per beach, kept between runs in data/clarity-state.json */
  var CST={};try{CST=JSON.parse(fs.readFileSync('data/clarity-state.json','utf8'));}catch(e){}
  var nowMs=Date.now(),cN=0;
  R.forEach((r,i)=>{try{var c=updateClarity(CST,r.name,CLB[i],{waveFt:r.wv,periodS:r.wp,windMph:r.w?r.w.avg:null,windDir:r.w?r.w.dir:null},nowMs,r.wv!=null&&!r.wvOld&&!noWave);
    r.clarity=c?{rating:c.rating,vis:c.vis,why:c.why}:null;if(c)cN++;}catch(e){r.clarity=null;}});
  console.log('Clarity outlook: '+cN+' of '+R.length+' beaches');
  {var HAB=await redTide();R.forEach(r=>{var t=rtNear(HAB,r.lat,r.lon);if(t)r.redtide=t;});console.log('Red tide warnings: '+R.filter(r=>r.redtide).length+' beaches');}
  if(fails>60){console.error('Too many forecast failures ('+fails+'); keeping the previous file.');process.exit(1);}
  fs.mkdirSync('data',{recursive:true});
  fs.writeFileSync('data/points.json',JSON.stringify(PTS));
  if(!noWave)fs.writeFileSync('data/clarity-state.json',JSON.stringify(CST));
  /* keep each beach's newest real reading; a beach that came back empty (or only had a reused value) keeps its earlier reading and time */
  {var nowIso=new Date().toISOString(),LG={};R.forEach(r=>{var e=LGALL[r.name]||{},o={wv:e.wv,wvAt:e.wvAt||PREV_ENV,wt:e.wt,wtAt:e.wtAt||PREV_ENV};
    if(r.wv!=null&&!r.wvOld){o.wv=r.wv;o.wvAt=nowIso;}if(r.wt!=null&&r.tsrc!=='last good reading'){o.wt=r.wt;o.wtAt=nowIso;}LG[r.name]=o;});
   fs.writeFileSync('data/last-good-readings.json',JSON.stringify({at:nowIso,beaches:LG}));}
  fs.writeFileSync('data/best-beaches.json',JSON.stringify({updated:new Date().toISOString(),envUpdated:(noWave||noTemp)?PREV_ENV:new Date().toISOString(),month:MO,windowStart:(R.find(r=>r.w)||{w:{}}).w.start||null,beaches:R}));
  /* daily history: one row per beach per day in data/history/YYYY-MM.csv, from the last run before 5 PM Eastern (the run nearest tonight's window). A later run that day replaces that day's rows. */
  try{saveHistory(R);}catch(e){console.log('History skipped: '+e.message);}
  /* the SharkLeash Drop Score shows out of 100; ties at 100 are ranked by the raw total (a front adds up to 5 on top) */
  var top=R.filter(r=>!r.flag&&!r.redtide).sort((a,b)=>b.raw-a.raw).slice(0,5);
  try{require('./images.js')(top,'data/post');console.log('Post images drawn');}catch(e){console.log('Post images skipped: '+e.message);}
  console.log('Top 5:');top.forEach((r,i)=>console.log((i+1)+'. '+r.name+' '+r.score));console.log('Forecast failures: '+fails);
  /* morning runs only: score this morning's 5-11 AM window. Wrapped so a problem here never touches the evening results above. */
  if(AM_RUN){try{await mornings(R,AMW,MO,BREP);}catch(e){console.log('Morning scores skipped: '+e.message);}}
})();

/* Morning Drop Score: same formula as the evening, fed the 5-11 AM wind, front and high tide; surf, water temp, sharks, bait and deep water are shared.
   A first guess until morning trip reports show what matters. Writes data/best-mornings.json and the morning post images (data/post/am). */
async function mornings(R,AMW,MO,BREP){
  var TA=new Array(SPOTS.length),j=0;
  async function tw(){while(j<SPOTS.length){var k=j++,s=SPOTS[k];if(!AMW[k])continue;var st0=near(TST,s[1],s[2],30,()=>true)||near(TSTX,s[1],s[2],30,()=>true);if(!st0)continue;
    var had=Object.keys(TCACHE).length;try{TA[k]=await tideHi(st0,AMW[k].start,AMW[k].hrs);}catch(e){}if(Object.keys(TCACHE).length>had)await sleep(150);}}
  await Promise.all([tw(),tw(),tw(),tw()]);
  var A=R.map((r,i)=>{var w=AMW[i];if(!w)return null;var s=SPOTS[i],sc=score(s,w,r.wv,r.wt,DEEP[i],MO,REG[i],TA[i],BREP[s[0]]);
    return {name:r.name,id:r.id,lat:r.lat,lon:r.lon,w:w,wv:r.wv,wt:r.wt,d10:r.d10,dc:r.dc,score:sc.tot,raw:sc.tot,parts:sc.b,sharks:sc.list,maybe:sc.maybe,release:sc.rel,bait:sc.bait,
      tide:TA[i]||undefined,clarity:r.clarity,redtide:r.redtide,flag:r.flag,note:r.note};}).filter(Boolean);
  if(A.length<R.length/2){console.log('Morning scores skipped: only '+A.length+' beaches had a morning forecast');return;}
  var first=A.find(a=>a.w&&a.w.start);
  fs.writeFileSync('data/best-mornings.json',JSON.stringify({updated:new Date().toISOString(),window:'5-11 AM',month:MO,windowStart:first?first.w.start:null,beaches:A}));
  var top=A.filter(r=>!r.flag&&!r.redtide).sort((a,b)=>b.raw-a.raw).slice(0,5);
  try{require('./images.js')(top,'data/post/am',{am:true});console.log('Morning post images drawn');}catch(e){console.log('Morning post images skipped: '+e.message);}
  console.log('Morning Top 5 (5-11 AM):');top.forEach((r,i)=>console.log((i+1)+'. '+r.name+' '+r.score));}

/* daily history: one row per beach per day in data/history/YYYY-MM.csv.
   Noon-5 PM Eastern: each run saves (a later run that day replaces that day's rows; the last one is nearest tonight's window).
   After 5 PM: only if that day has no rows yet (every afternoon run failed), so a day is never missing. Those rows say saved=late.
   Also keeps data/past/<beach>.json (the site's Past Years panel) growing night by night, filling any gap from this history. */
function etNow(){var p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date()),g=k=>(p.find(x=>x.type===k)||{}).value;
  return {day:g('year')+'-'+g('month')+'-'+g('day'),hr:+g('hour')};}
function csvSplit(l){var out=[],cur='',q=false;for(var i=0;i<l.length;i++){var c=l[i];
    if(q){if(c==='"'&&l[i+1]==='"'){cur+='"';i++;}else if(c==='"')q=false;else cur+=c;}
    else if(c==='"')q=true;else if(c===','){out.push(cur);cur='';}else cur+=c;}
  out.push(cur);return out;}
function saveHistory(R){
  var E=etNow(),day=E.day,hr=E.hr;
  if(hr<12){console.log('History: not saved this run (saves start at noon Eastern)');return;}
  var q=v=>{v=v==null?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;},rd=(v,n)=>v==null||isNaN(v)?'':(+v).toFixed(n);
  var H=['date','beach','score','raw','wind_mph','wind_dir','front','waves_ft','water_f','clarity','tide_high','pts_wind','pts_waves','pts_temp','pts_sharks','pts_bait','pts_deep','pts_front','pts_tide','sharks_running','bait_running','flagged','run_utc',
    'bait_src','bait_yes','bait_no','saved','beach_id'];
  fs.mkdirSync('data/history',{recursive:true});
  var f='data/history/'+day.slice(0,7)+'.csv',L=fs.existsSync(f)?fs.readFileSync(f,'utf8').split('\n'):[],oldN=L.length?csvSplit(L[0]).length:H.length;
  var have=L.slice(1).some(l=>l.slice(0,10)===day),late=hr>=17;
  if(late&&have){console.log('History: '+day+' already saved this afternoon; nothing to add');try{pastAppend(day,R);}catch(e){console.log('Past files skipped: '+e.message);}return;}
  /* bait source, same rule as the score: two matching angler reports (or a trusted tester) override the calendar */
  var bsrc=r=>{var c=r.baitRep||{},y=c.yes||0,n=c.no||0;return (y>=2&&y>n)||r.baitTr==='yes'?'reports_yes':(n>=2&&n>y)||r.baitTr==='no'?'reports_no':'calendar';};
  var now=new Date().toISOString(),rows=R.map(r=>{var b=r.parts||{},c=r.baitRep||{};return [day,r.name,r.score,r.raw,r.w?r.w.avg:'',r.w?r.w.dir:'',r.w&&r.w.front?1:0,rd(r.wv,1),rd(r.wt,0),r.clarity?r.clarity.rating:'',r.tide&&r.tide.high?r.tide.high:'',
    b.wind,b.waves,b.temp,b.sharks,b.bait,b.deep,b.front,b.tide,(r.sharks||[]).join('; '),(r.bait||[]).map(x=>Array.isArray(x)?x[0]:x).join('; '),r.flag?1:0,now,
    bsrc(r),c.yes||0,c.no||0,late?'late':'window',r.id||''].map(q).join(',');});
  /* rows saved before these columns existed get blank cells for them, so every row lines up with the header */
  var pad=H.length>oldN?','.repeat(H.length-oldN):'';
  var keep=L.slice(1).filter(l=>l&&l.slice(0,10)!==day).map(l=>l+pad);
  fs.writeFileSync(f,[H.join(',')].concat(keep,rows).join('\n')+'\n');
  console.log('History: saved '+rows.length+' beaches for '+day+' to '+f+(late?' (late: no afternoon run saved today)':''));
  try{pastAppend(day,R);}catch(e){console.log('Past files skipped: '+e.message);}
}
/* data/past/<beach>.json: [score, wind_mph, wind_dir, waves_ft, water_f, high_tide_in_window] per night.
   Adds every saved night after the file's last day (today included), read from the history CSVs, so a missed run never leaves a hole. */
function pastAppend(day,R){
  if(!fs.existsSync('data/past'))return;
  var slug=n=>String(n).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),next=d=>new Date(Date.parse(d+'T12:00:00Z')+864e5).toISOString().slice(0,10);
  var num=v=>v===''||v==null||isNaN(+v)?null:+v,M={};
  var month=ym=>{if(M[ym])return M[ym];var f='data/history/'+ym+'.csv',o={};if(fs.existsSync(f)){var L=fs.readFileSync(f,'utf8').split('\n'),H=csvSplit(L[0]),I=n=>H.indexOf(n);
      L.slice(1).forEach(l=>{if(!l)return;var r=csvSplit(l);(o[r[I('date')]]=o[r[I('date')]]||{})[r[I('beach')]]=r;});o._I=I;}return M[ym]=o;};
  var files=0,nights=0;
  R.forEach(r=>{var pf='data/past/'+(r.id||slug(r.name))+'.json';if(!fs.existsSync(pf))return;
    var p=JSON.parse(fs.readFileSync(pf,'utf8')),add=0;
    for(var d=next(p.to);d<=day;d=next(d)){var m=month(d.slice(0,7)),row=m[d]&&m[d][r.name];if(!row)continue;var I=m._I;
      p.days[d]=[num(row[I('score')]),num(row[I('wind_mph')]),row[I('wind_dir')]||null,num(row[I('waves_ft')]),num(row[I('water_f')]),row[I('tide_high')]?1:0];
      if(!p.liveFrom)p.liveFrom=d;p.to=d;add++;}
    /* today's row can change until 5 PM (a later afternoon run replaces it): keep the file in step */
    var m=month(day.slice(0,7)),row=m[day]&&m[day][r.name];
    if(!add&&row&&p.days[day]){var I=m._I,v=[num(row[I('score')]),num(row[I('wind_mph')]),row[I('wind_dir')]||null,num(row[I('waves_ft')]),num(row[I('water_f')]),row[I('tide_high')]?1:0];
      if(JSON.stringify(v)!==JSON.stringify(p.days[day])){p.days[day]=v;add=1;}}
    if(add){fs.writeFileSync(pf,JSON.stringify(p));files++;nights+=add;}});
  console.log('Past files: '+files+' beaches updated, '+nights+' nights added or refreshed');
}
