import fs from "node:fs/promises";
import crypto from "node:crypto";

const sources = [
  { id:"hq", name:"IGNOU Announcements", url:"https://www.ignou.ac.in/announcements/0", kind:"html", keywords:["bca","bca_new","tee","assignment","exam","practical","counselling","regional","guwahati","july 2026","2026"] },
  { id:"bca", name:"BCA_NEW Programme", url:"https://www.ignou.ac.in/schools/programme/BCA_NEW", kind:"html", keywords:["bca","bcs111","bcs12","bcsl13","begla136","bevae181","2026"] },
  { id:"assign", name:"Current Assignments", url:"https://www.ignou.ac.in/pages/43", kind:"html", keywords:["bca","bca_new","bcs111","bcs12","bcsl13","begla136","bevae181","2026-27","assignment"] },
  { id:"rc", name:"RC Guwahati", url:"https://rcguwahati.ignou.ac.in/", kind:"html", keywords:["bca","practical","counselling","counseling","tee","exam","0400","bcs","guwahati","2026"] },
  { id:"tee", name:"TEE Exam Portal", url:"https://exam.ignou.ac.in/", kind:"html", keywords:["december 2026","tee","exam","form","hall ticket","date sheet","bca","2026"] }
];

const previous = await readJson("public/monitor.json", {version:1, generatedAt:null, sources:{}, events:[]});
const now = new Date().toISOString();
const result = {version:1, generatedAt:now, sources:{}, events:[]};

function hash(value){ return crypto.createHash("sha256").update(value).digest("hex"); }
function normalize(s){ return s.replace(/\s+/g," ").replace(/&nbsp;/gi," ").trim(); }
function stripHtml(s){ return normalize(s.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ")); }
function escText(s){ return s.replace(/\s+/g," ").trim(); }

async function fetchSource(source){
  try{
    const response=await fetch(source.url,{headers:{"User-Agent":"IGNOU-BCA-Control-Centre-Monitor/1.0"}});
    const contentType=response.headers.get("content-type")||"";
    const body=await response.text();
    const clean=stripHtml(body);
    const lower=clean.toLowerCase();
    const relevant=source.keywords.filter(k=>lower.includes(k));
    const links=[];
    if(contentType.includes("text/html") || body.includes("<html") || body.includes("<a ")){
      const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while((m=re.exec(body)) && links.length<250){
        const label=stripHtml(m[2]);
        const href=m[1];
        const text=(label+" "+href).trim();
        if(!text) continue;
        const l=text.toLowerCase();
        if(source.keywords.some(k=>l.includes(k)) || /notice|announcement|assignment|pdf|practical|counsel|exam|tee/i.test(l)){
          let absolute;
          try{ absolute=new URL(href,source.url).href; }catch{ continue; }
          links.push({title:label.slice(0,180),url:absolute});
        }
      }
    }
    return {ok:response.ok,status:response.status,hash:hash(clean),title:source.name,url:source.url,relevantKeywords:relevant,links:dedupe(links),excerpt:clean.slice(0,700)};
  }catch(error){
    return {ok:false,status:0,hash:null,title:source.name,url:source.url,relevantKeywords:[],links:[],excerpt:"",error:String(error)};
  }
}
function dedupe(items){
  const seen=new Set();
  return items.filter(x=>{const k=x.url+"|"+x.title;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,80);
}

for(const source of sources){
  const current=await fetchSource(source);
  const old=previous.sources?.[source.id];
  const changed=!!old && current.hash && old.hash && current.hash!==old.hash;
  const isNew=!old;
  result.sources[source.id]={...current,lastChangedAt:changed||isNew?now:(old?.lastChangedAt||now),checkedAt:now};
  const oldLinks=new Set((old?.links||[]).map(x=>x.url+"|"+x.title));
  const newLinks=(current.links||[]).filter(x=>!oldLinks.has(x.url+"|"+x.title));
  if(isNew){
    result.events.push({id:source.id+"-initial-"+now.slice(0,10),sourceId:source.id,source:source.name,type:"BASELINE",priority:"INFO",title:"Initial automatic monitoring baseline created",text:"The source is now being monitored automatically. Future relevant changes will appear here.",url:source.url,detectedAt:now});
  }else if(changed){
    result.events.push({id:source.id+"-changed-"+now,sourceId:source.id,source:source.name,type:"SOURCE_CHANGED",priority:priorityFor(source.id),title:source.name+" changed",text:"The monitored official source changed since the previous scan. Open the source to verify the new information.",url:source.url,detectedAt:now});
  }
  for(const link of newLinks.slice(0,12)){
    result.events.push({id:hash(source.id+"|"+link.url+"|"+link.title),sourceId:source.id,source:source.name,type:"NEW_ITEM",priority:priorityFor(source.id),title:link.title||"New official item detected",text:"A new relevant official link was detected. Verify the original source before acting.",url:link.url,detectedAt:now});
  }
}
result.events=[...(previous.events||[]),...result.events].slice(-150);
await fs.mkdir("public",{recursive:true});
await fs.writeFile("public/monitor.json",JSON.stringify(result,null,2)+"\n");
function priorityFor(id){ return id==="tee"||id==="assign"?"ACTION":id==="rc"||id==="bca"?"IMPORTANT":"WATCH"; }
async function readJson(path,fallback){ try{return JSON.parse(await fs.readFile(path,"utf8"));}catch{return fallback;} }
