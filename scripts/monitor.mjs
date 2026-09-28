import fs from "node:fs/promises";
import crypto from "node:crypto";

const sources = [
  { id:"hq", name:"IGNOU Announcements", url:"https://www.ignou.ac.in/announcements/0", priority:"WATCH", keywords:["bca","bca_new","bcs111","bcs12","bcsl13","begla136","bevae181","tee","term-end","exam form","assignment","practical","counselling","guwahati"] },
  { id:"bca", name:"BCA_NEW Programme", url:"https://www.ignou.ac.in/schools/programme/BCA_NEW", priority:"IMPORTANT", keywords:["bca_new","bcs111","bcs12","bcsl13","begla136","bevae181","programme guide"] },
  { id:"assign", name:"Current Assignments", url:"https://www.ignou.ac.in/pages/43", priority:"ACTION", keywords:["bca_new","bcane","bcs111","bcs-111","bcs12","bcs-012","bcsl13","bcsl-013","begla136","begla-136","bevae181","bevae-181","assignment"] },
  { id:"rc", name:"RC Guwahati", url:"https://rcguwahati.ignou.ac.in/", priority:"IMPORTANT", keywords:["bca","practical","counselling","counseling","tee","exam","0400","bcsl","guwahati"] },
  { id:"tee", name:"TEE Exam Portal", url:"https://exam.ignou.ac.in/", priority:"ACTION", keywords:["december 2026","dec-2026","tee","exam form","hall ticket","date sheet","bca"] }
];

const previous = await readJson("public/monitor.json", {version:2,generatedAt:null,sources:{},events:[]});
const now = new Date().toISOString();
const result = {version:2,generatedAt:now,sources:{},events:[]};

function hash(value){return crypto.createHash("sha256").update(value).digest("hex");}
function normalize(s){return String(s||"").replace(/&nbsp;/gi," ").replace(/\s+/g," ").trim();}
function stripHtml(s){return normalize(String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," "));}
function dedupe(items){const seen=new Set();return items.filter(x=>{const k=x.url+"|"+x.title;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,40);}
function relevantLink(source,title,url){
  const t=(title+" "+url).toLowerCase();
  const generic=/^(home|about us|contact us|login|close|click here|click here for notification|regional network|jobs at ignou|telephone directory|committee against sexual harassment|common prospectus|study material catalogue|news\/announcements)$/i;
  if(!title || generic.test(title.trim())) return false;
  if(source.id==="assign"){
    return /(bca[_ -]?new|bcs[- ]?111|bcs[- ]?012|bcsl[- ]?013|begla[- ]?136|bevae[- ]?181)/i.test(t) &&
      (/assign|assignment|\.pdf/i.test(t));
  }
  if(source.id==="bca"){
    return /programme guide/i.test(t) || /(bcs[- ]?111|bcs[- ]?012|bcsl[- ]?013|begla[- ]?136|bevae[- ]?181)/i.test(t);
  }
  if(source.id==="tee"){
    return /(december|dec-?2026|tee|exam form|hall ticket|date sheet|bca)/i.test(t);
  }
  if(source.id==="rc"){
    return /(bca|bcsl|practical|counselling|counseling|tee|exam|0400|guwahati)/i.test(t);
  }
  return /(bca|bca[_ -]?new|bcs[- ]?111|bcs[- ]?012|bcsl[- ]?013|begla[- ]?136|bevae[- ]?181|tee|term[- ]?end|exam form|assignment|practical|counselling|guwahati)/i.test(t);
}

async function fetchSource(source){
  try{
    const response=await fetch(source.url,{headers:{"User-Agent":"IGNOU-BCA-Control-Centre-Monitor/2.0","Accept":"text/html,application/xhtml+xml"}});
    const body=await response.text();
    const clean=stripHtml(body);
    const lower=clean.toLowerCase();
    const relevantKeywords=source.keywords.filter(k=>lower.includes(k));
    const links=[];
    if(response.ok && (response.headers.get("content-type")||"").includes("text/html")){
      const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while((m=re.exec(body)) && links.length<120){
        const title=stripHtml(m[2]).slice(0,180);
        let absolute;
        try{absolute=new URL(m[1],source.url).href;}catch{continue;}
        if(!relevantLink(source,title,absolute))continue;
        links.push({title,url:absolute});
      }
    }
    return {ok:response.ok,status:response.status,hash:response.ok?hash(clean):null,title:source.name,url:source.url,relevantKeywords,links:dedupe(links),excerpt:clean.slice(0,700)};
  }catch(error){
    return {ok:false,status:0,hash:null,title:source.name,url:source.url,relevantKeywords:[],links:[],excerpt:"",error:String(error)};
  }
}

for(const source of sources){
  const current=await fetchSource(source);
  const old=previous.sources?.[source.id];
  const changed=Boolean(old?.hash && current.hash && old.hash!==current.hash);
  const isNew=!old;
  result.sources[source.id]={...current,lastChangedAt:changed||isNew?now:(old?.lastChangedAt||null),checkedAt:now};
  if(isNew){
    result.events.push({id:source.id+"-baseline-"+now.slice(0,10),sourceId:source.id,source:source.name,type:"BASELINE",priority:"INFO",title:"Automatic monitoring baseline created",text:"The source is now being monitored. Future relevant changes will appear here.",url:source.url,detectedAt:now});
  }else if(changed){
    result.events.push({id:source.id+"-changed-"+now,sourceId:source.id,source:source.name,type:"SOURCE_CHANGED",priority:source.priority,title:source.name+" changed",text:"The monitored official source changed since the previous scan. Open the source to verify what changed.",url:source.url,detectedAt:now});
  }
  const oldLinks=new Set((old?.links||[]).map(x=>x.url+"|"+x.title));
  for(const link of (current.links||[]).filter(x=>!oldLinks.has(x.url+"|"+x.title)).slice(0,12)){
    result.events.push({id:hash(source.id+"|"+link.url+"|"+link.title),sourceId:source.id,source:source.name,type:"NEW_ITEM",priority:source.priority,title:link.title||"New official item detected",text:"A new relevant official link was detected. Verify the original source before acting.",url:link.url,detectedAt:now});
  }
}
result.events=[...(previous.events||[]),...result.events].slice(-100);
await fs.mkdir("public",{recursive:true});
const monitorJson=JSON.stringify(result,null,2)+"\n";
await fs.writeFile("public/monitor.json",monitorJson);
await fs.writeFile("monitor.json",monitorJson);
await fs.writeFile("public/monitor.js","window.__IGNOU_MONITOR__ = "+JSON.stringify(result)+";\n");

async function readJson(path,fallback){try{return JSON.parse(await fs.readFile(path,"utf8"));}catch{return fallback;}}
