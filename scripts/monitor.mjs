// Bypass self-signed or invalid cert chains on Indian educational portals
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import fs from "node:fs/promises";
import crypto from "node:crypto";

const sources = [
  { id:"hq", name:"IGNOU Announcements", url:"https://www.ignou.ac.in/announcements/0", priority:"WATCH", keywords:["bca","bca_new","bcs111","bcs12","bcsl13","begla136","bevae181","tee","term-end","exam form","assignment","practical","counselling","guwahati"] },
  { id:"bca", name:"BCA_NEW Programme", url:"https://www.ignou.ac.in/schools/programme/BCA_NEW", priority:"IMPORTANT", keywords:["bca_new","bcs111","bcs12","bcsl13","begla136","bevae181","programme guide"] },
  { id:"assign", name:"Current Assignments", url:"https://www.ignou.ac.in/pages/43", priority:"ACTION", keywords:["bca_new","bcane","bcs111","bcs-111","bcs12","bcs-012","bcsl13","bcsl-013","begla136","begla-136","bevae181","bevae-181","assignment"] },
  { id:"rc", name:"RC Guwahati", url:"http://rcguwahati.ignou.ac.in/", priority:"IMPORTANT", keywords:["bca","practical","counselling","counseling","tee","exam","0400","bcsl","guwahati"] },
  { id:"tee", name:"TEE Exam Portal", url:"https://exam.ignou.ac.in/", priority:"ACTION", keywords:["december 2026","dec-2026","tee","exam form","hall ticket","date sheet","bca"] }
];

const previous = await readJson("public/monitor.json", {version:2,generatedAt:null,sources:{},events:[]});
const now = new Date().toISOString();
const result = {version:2,generatedAt:now,sources:{},events:[]};

function hash(value){return crypto.createHash("sha256").update(value).digest("hex");}
function normalize(s){return String(s||"").replace(/&nbsp;/gi," ").replace(/\s+/g," ").trim();}
function stripHtml(s){return normalize(String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," "));}
function dedupe(items){const seen=new Set();return items.filter(x=>{const k=x.url+"|"+x.title;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,40);}

const genericNav = /^(home|about us|contact us|programmes|programmes list|student corner|study centres|news & events|photo gallery|visitor|history|naac|naac - activities|achievements|rc staff|rc profile|facilities|facilities \/ mannuals & performa|e-newsletter|jurisdiction|alumni|brochure|contact details|academic counsellors|staff at lsc|login|close|click here|click here for notification|regional network|jobs at ignou|telephone directory|committee against sexual harassment|common prospectus|study material catalogue|news\/announcements|a|a\+|a\-)$/i;

function relevantLink(source,title,url){
  const cleanTitle = normalize(title).replace(/[|;\-]+/g," ").trim();
  if(!title || cleanTitle.length < 3 || genericNav.test(cleanTitle) || url.endsWith("#") || url.endsWith("#content")) return false;
  
  let path = "";
  try { path = new URL(url).pathname.toLowerCase(); } catch { path = url.toLowerCase(); }
  if (path === "/" || path === "" || /aboutus\/(1|2|3|5|6|8|9|13|employee)/i.test(path) || /photogallery/i.test(path)) {
    return false;
  }

  if(source.id === "assign"){
    return /(bca[_ -]?new|bcs[- ]?111|bcs[- ]?012|bcsl[- ]?013|begla[- ]?136|bevae[- ]?181)/i.test(cleanTitle+" "+path) &&
      (/assign|assignment|\.pdf/i.test(cleanTitle+" "+path));
  }
  if(source.id === "bca"){
    return /programme guide/i.test(cleanTitle) || /(bcs[- ]?111|bcs[- ]?012|bcsl[- ]?013|begla[- ]?136|bevae[- ]?181)/i.test(cleanTitle+" "+path);
  }
  if(source.id === "tee"){
    return /(december|dec-?2026|tee|exam form|hall ticket|date sheet|datesheet|bca)/i.test(cleanTitle+" "+path);
  }
  if(source.id === "rc"){
    return /(bca|bcsl|bcs|practical|counselling|counseling|tee|exam|0400|assignment|schedule|datesheet|date sheet|notice|circular|userfiles|\.pdf)/i.test(cleanTitle+" "+path);
  }
  return /(bca|bca[_ -]?new|bcs[- ]?111|bcs[- ]?012|bcsl[- ]?013|begla[- ]?136|bevae[- ]?181|tee|term[- ]?end|exam form|assignment|practical|counselling|guwahati)/i.test(cleanTitle+" "+path);
}

function categorizeNotice(title, url) {
  const t = (title + " " + url).toLowerCase();
  if (/practical|lab|viva|bcsl/i.test(t)) return { tag: "PRACTICAL", priority: "ACTION", icon: "??" };
  if (/exam form/i.test(t)) return { tag: "EXAM FORM", priority: "ACTION", icon: "??" };
  if (/date sheet|datesheet|schedule/i.test(t)) return { tag: "DATE SHEET", priority: "ACTION", icon: "??" };
  if (/hall ticket|admit card/i.test(t)) return { tag: "HALL TICKET", priority: "ACTION", icon: "??" };
  if (/assignment|assign/i.test(t)) return { tag: "ASSIGNMENT", priority: "ACTION", icon: "??" };
  if (/counsel|counselling|induction/i.test(t)) return { tag: "COUNSELLING", priority: "IMPORTANT", icon: "??" };
  if (/re-reg|admission|registration/i.test(t)) return { tag: "ADMISSION", priority: "IMPORTANT", icon: "??" };
  if (/study centre|sc[0-9]|0400/i.test(t)) return { tag: "STUDY CENTRE", priority: "WATCH", icon: "???" };
  if (/\.pdf($|\?)/i.test(url)) return { tag: "CIRCULAR / PDF", priority: "INFO", icon: "??" };
  return { tag: "OFFICIAL NOTICE", priority: "INFO", icon: "??" };
}

function generateShortSummary(title, url, sourceName) {
  const t = (title + " " + url).toLowerCase();
  const isPdf = /\.pdf($|\?)/i.test(url);
  
  if (/practical|bcsl|lab/i.test(t)) return "Practical examination schedule or laboratory counseling session advisory for BCA learners.";
  if (/date sheet|datesheet/i.test(t)) return "Tentative examination timetable and slot schedule published. Verify course codes and dates.";
  if (/exam form/i.test(t)) return "Examination form portal open. Submit before deadline to avoid late fees.";
  if (/hall ticket|admit card/i.test(t)) return "Official admit card / hall ticket portal link for upcoming examination session.";
  if (/assignment/i.test(t)) return "Assignment question paper or submission deadline guidelines published.";
  if (/counsel|induction/i.test(t)) return "Academic counseling timetable and online/offline session schedule.";
  if (/re-reg|admission/i.test(t)) return "Admission or re-registration deadline notice and instructions.";
  if (/study centre|sc[0-9]|0400/i.test(t)) return "Study centre network, coordinator directory, and learner support contacts for SC 0400.";
  if (isPdf) return `Official PDF circular released on ${sourceName} portal. Click to download.`;
  return `Official announcement published on ${sourceName}. Verify requirements before acting.`;
}

async function fetchSource(source){
  try{
    const response=await fetch(source.url,{
      signal: AbortSignal.timeout(20000),
      headers:{
        "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
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
  let current=await fetchSource(source);
  const old=previous.sources?.[source.id];
  if(!current.ok && old && old.hash){
    current = { ...old, error: current.error, transientFailure: true };
  }
  const changed=Boolean(old?.hash && current.hash && old.hash!==current.hash);
  const isNew=!old;
  result.sources[source.id]={...current,lastChangedAt:changed||isNew?now:(old?.lastChangedAt||null),checkedAt:now};
  
  if(isNew){
    result.events.push({
      id:source.id+"-baseline-"+now.slice(0,10),
      sourceId:source.id,
      source:source.name,
      type:"BASELINE",
      priority:"INFO",
      tag:"BASELINE",
      icon:"??",
      title:source.name+" monitor initialized",
      text:"Continuous official source monitoring active. Verified updates and notices will appear here.",
      url:source.url,
      detectedAt:now
    });
  }else if(changed){
    result.events.push({
      id:source.id+"-changed-"+now,
      sourceId:source.id,
      source:source.name,
      type:"SOURCE_CHANGED",
      priority:source.priority,
      tag:"UPDATED",
      icon:"?",
      title:source.name+" updated",
      text:"Monitored official portal changed since previous scan. Click verify to check latest notices.",
      url:source.url,
      detectedAt:now
    });
  }
  
  const oldLinks=new Set((old?.links||[]).map(x=>x.url+"|"+x.title));
  for(const link of (current.links||[]).filter(x=>!oldLinks.has(x.url+"|"+x.title)).slice(0,12)){
    const cat = categorizeNotice(link.title, link.url);
    const summary = generateShortSummary(link.title, link.url, source.name);
    result.events.push({
      id:hash(source.id+"|"+link.url+"|"+link.title),
      sourceId:source.id,
      source:source.name,
      type:"NEW_ITEM",
      priority:cat.priority,
      tag:cat.tag,
      icon:cat.icon,
      title:link.title||"New official notice",
      text:summary,
      url:link.url,
      detectedAt:now
    });
  }
}

// Purge old baseline or navigation noise from history
const cleanPrevEvents = (previous.events||[]).filter(e=>{
  const title = normalize(e.title||"").replace(/[|;\-]+/g," ").trim();
  return !genericNav.test(title) && !/visitor|history|staff at lsc|achievements|rc staff|photo gallery/i.test(title);
});

result.events=[...cleanPrevEvents, ...result.events].slice(-60);
await fs.mkdir("public",{recursive:true});
const monitorJson=JSON.stringify(result,null,2)+"\n";
await fs.writeFile("public/monitor.json",monitorJson);
await fs.writeFile("monitor.json",monitorJson);
await fs.writeFile("public/monitor.js","window.__IGNOU_MONITOR__ = "+JSON.stringify(result)+";\nif(document.readyState===\"loading\"){document.addEventListener(\"DOMContentLoaded\",()=>{if(typeof window.renderNotifications===\"function\")window.renderNotifications();});}else if(typeof window.renderNotifications===\"function\"){window.renderNotifications();}\n");

async function readJson(path,fallback){try{return JSON.parse(await fs.readFile(path,"utf8"));}catch{return fallback;}}
