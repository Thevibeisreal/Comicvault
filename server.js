const express = require("express");
const cheerio = require("cheerio");
const PDFDocument = require("pdfkit");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const MEDIA = path.join(DATA, "media");
fs.mkdirSync(MEDIA, { recursive: true });
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));
app.get("/health",(_req,res)=>res.json({ok:true}));

function allowedUrl(raw) {
  const u = new URL(raw);
  if (!["http:","https:"].includes(u.protocol)) throw new Error("Paste a valid http or https comic URL.");
  if (["localhost","127.0.0.1","0.0.0.0"].includes(u.hostname) || u.hostname.endsWith(".local")) throw new Error("That address cannot be imported.");
  return u;
}
function absolute(base, value) {
  try { return new URL(value,base).href; } catch { return null; }
}
async function getHtml(url) {
  const r = await fetch(url,{redirect:"follow",headers:{
    "User-Agent":"Mozilla/5.0 (compatible; ComicVault/1.0; personal comic archiver)",
    "Accept":"text/html,application/xhtml+xml"
  },signal:AbortSignal.timeout(20000)});
  if (!r.ok) throw new Error(`The comic site returned HTTP ${r.status}.`);
  const type=r.headers.get("content-type")||"";
  if(!type.includes("text/html")) throw new Error("That link did not return a readable comic webpage.");
  return await r.text();
}
function imageCandidates(html,pageUrl) {
  const $=cheerio.load(html), out=[];
  $("meta[property='og:image'],meta[name='twitter:image']").each((_,e)=>{
    const src=$(e).attr("content"); if(src) out.push({url:absolute(pageUrl,src),score:5});
  });
  $("img").each((_,e)=>{
    const el=$(e);
    const src=el.attr("data-src")||el.attr("data-lazy-src")||el.attr("data-original")||el.attr("src");
    if(!src||src.startsWith("data:")) return;
    const url=absolute(pageUrl,src); if(!url) return;
    const hint=((el.attr("id")||"")+" "+(el.attr("class")||"")+" "+(el.attr("alt")||"")).toLowerCase();
    let score=0;
    if(/comic|toon|manga|episode|webtoon|panel|page/.test(hint)) score+=10;
    if(/logo|avatar|profile|banner|icon|ad|emoji/.test(hint)) score-=20;
    const w=Number(el.attr("width")||0),h=Number(el.attr("height")||0);
    score+=Math.min(w,2000)/200+Math.min(h,3000)/300;
    out.push({url,score});
  });
  const seen=new Set();
  return out.filter(x=>x.url&&/^https?:/.test(x.url)&&!seen.has(x.url)&&seen.add(x.url))
    .sort((a,b)=>b.score-a.score).map(x=>x.url);
}
function comicFuryArchiveLinks(html,base) {
  const $=cheerio.load(html), urls=[];
  $("a[href]").each((_,e)=>{
    const href=absolute(base,$(e).attr("href"));
    if(href&&new URL(href).hostname===new URL(base).hostname&&/\/comics\/\d+\/?$/i.test(new URL(href).pathname)) urls.push(href);
  });
  return [...new Set(urls)].sort((a,b)=>{
    const n=x=>Number(new URL(x).pathname.match(/\/comics\/(\d+)/i)?.[1]||0);
    return n(a)-n(b);
  });
}
async function imageToFile(url, referer) {
  const response=await fetch(url,{redirect:"follow",headers:{
    "User-Agent":"Mozilla/5.0 (compatible; ComicVault/1.0)",
    "Referer":referer
  },signal:AbortSignal.timeout(25000)});
  if(!response.ok) throw new Error(`A comic image could not be retrieved (HTTP ${response.status}).`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>25*1024*1024) throw new Error("A page image exceeded the 25 MB limit.");
  const meta=await sharp(bytes,{failOn:"none"}).metadata();
  if(!meta.width||!meta.height||meta.width<180||meta.height<180) throw new Error("The source returned an image too small to be a comic page.");
  const file=path.join(MEDIA,crypto.randomUUID()+".jpg");
  await sharp(bytes,{failOn:"none"}).rotate().jpeg({quality:90}).toFile(file);
  return {file,width:meta.width,height:meta.height};
}
async function collect(url) {
  const html=await getHtml(url.href);
  const host=url.hostname.toLowerCase();
  let pages=[];
  // ComicFury archive support: when a series URL is supplied, try its public archive.
  if(host==="thecomicseries.com"||host.endsWith(".thecomicseries.com")||host==="comicfury.com"||host.endsWith(".comicfury.com")) {
    let pageUrls=[];
    if(/\/comics\/\d+\/?$/i.test(url.pathname)) pageUrls=[url.href];
    else {
      const archiveUrl=new URL("/archive/",url.origin).href;
      const archiveHtml=await getHtml(archiveUrl);
      pageUrls=comicFuryArchiveLinks(archiveHtml,archiveUrl);
      if(!pageUrls.length) pageUrls=comicFuryArchiveLinks(html,url.href);
    }
    if(pageUrls.length>0) {
      if(pageUrls.length>300) pageUrls=pageUrls.slice(0,300);
      for(let i=0;i<pageUrls.length;i++) {
        const purl=pageUrls[i];
        try {
          const ph=purl===url.href?html:await getHtml(purl);
          const $=cheerio.load(ph);
          const imgs=imageCandidates(ph,purl);
          const comicImg=imgs.find(src=>!/(logo|avatar|banner|icon)/i.test(src));
          if(comicImg) pages.push({url:comicImg,source:purl,title:$("title").text().trim()||`Page ${i+1}`});
        } catch(e) { console.warn("Skipped",purl,e.message); }
      }
    }
  }
  // Generic public chapter/page support. Collect only images actually present in the supplied page.
  if(!pages.length) {
    const imgs=imageCandidates(html,url.href);
    const $=cheerio.load(html);
    const title=$("h1").first().text().trim()||$("title").text().trim()||"Comic";
    for(const img of imgs.slice(0,80)) pages.push({url:img,source:url.href,title});
  }
  if(!pages.length) throw new Error("I couldn't find public comic-page images at that link. This site may load pages dynamically or require an official login/app. ComicVault will not bypass those restrictions.");
  const downloaded=[];
  for(let i=0;i<pages.length;i++) {
    try {
      const image=await imageToFile(pages[i].url,pages[i].source);
      downloaded.push({...image,title:pages[i].title,number:i+1});
    } catch(e) { console.warn("Image skipped:",e.message); }
  }
  if(!downloaded.length) throw new Error("The page images were detected but could not be downloaded.");
  return {title:cheerio.load(html)("title").text().trim()||"ComicVault comic",pages:downloaded};
}
app.post("/api/download",async(req,res)=>{
  let files=[];
  try {
    const url=allowedUrl(String(req.body.url||"").trim());
    const comic=await collect(url);
    res.setHeader("Content-Type","application/pdf");
    res.setHeader("Content-Disposition",'attachment; filename="ComicVault-comic.pdf"');
    const pdf=new PDFDocument({autoFirstPage:false,compress:true,margin:18});
    pdf.pipe(res);
    for(const p of comic.pages) {
      const maxW=576,maxH=900;
      const scale=Math.min(maxW/p.width,maxH/p.height,1);
      const w=p.width*scale,h=p.height*scale;
      pdf.addPage({size:[w+36,h+36],margin:18});
      pdf.image(p.file,18,18,{width:w,height:h});
    }
    pdf.end();
    files=comic.pages.map(p=>p.file);
    res.on("finish",()=>files.forEach(f=>{try{fs.unlinkSync(f)}catch{}}));
  } catch(e) {
    if(!res.headersSent) res.status(400).json({error:e.message||"Comic download failed."});
  }
});
app.listen(PORT,()=>console.log(`ComicVault listening on ${PORT}`));
