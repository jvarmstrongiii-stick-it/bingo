const assert=require("node:assert/strict");const document={getElementById:()=>({})};const localStorage={getItem:()=>null};


const $=id=>document.getElementById(id);
const pats=["Any Horizontal Line","Any Vertical Line","Any Diagonal Line","Four Corners","X","Blackout / Coverall","Center 3×3 Square"];
const storageKey="bingo-validator-v2";
let called=new Set(),pattern=pats[0],locked=false,stream=null,workerPromise=null,busy=false,generation=0;
let cropPoints=[];
let card=Array.from({length:5},(_,r)=>Array.from({length:5},(_,c)=>r===2&&c===2?"FREE":null));
try{const s=JSON.parse(localStorage.getItem(storageKey)||"null");if(s&&s.confirmed&&pats.includes(s.pattern)&&Array.isArray(s.called)&&s.called.every(n=>Number.isInteger(n)&&n>=1&&n<=75)){called=new Set(s.called);pattern=s.pattern;locked=true}}catch{}
function save(){try{localStorage.setItem(storageKey,JSON.stringify({called:[...called],pattern,confirmed:locked}))}catch{}}
function render75(){
 $("grid75").replaceChildren();
 for(let n=1;n<=75;n++){const b=document.createElement("button");b.className="n "+(called.has(n)?"on":"");b.textContent=n;b.setAttribute("aria-pressed",String(called.has(n)));b.onclick=()=>{called.has(n)?called.delete(n):called.add(n);$("boardConfirmed").checked=false;render75()};$("grid75").append(b)}
 $("calledCount").textContent=called.size;
}
function renderPatterns(){
 $("patterns").replaceChildren();
 pats.forEach(p=>{const b=document.createElement("button");b.className="p "+(pattern===p?"on":"");b.textContent=p;b.onclick=()=>{pattern=p;renderPatterns()};$("patterns").append(b)})
}
function showMode(){$("stepBoard").classList.toggle("hidden",locked);$("stepCards").classList.toggle("hidden",!locked);if(locked)$("lockedSummary").textContent=pattern+" • "+called.size+" confirmed numbers"}
function status(kind,text){$(kind+"Status").textContent=text}
function setBusy(value){busy=value;["captureBoard","captureCard","boardFile","cardFile","lockGame","verifyCard","useBoardCamera","useCardCamera","manualBoard","manualCard"].forEach(id=>$(id).disabled=value)}
async function startCamera(kind){
 try{
  if(!stream||!stream.getVideoTracks().some(t=>t.readyState==="live"))stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
  // Attach only to the visible video; sharing one stream across two videos can
  // leave a mobile browser displaying a paused preview.
  const v=$(kind+"Cam");v.srcObject=stream;await v.play();
  $(kind+"Preview").classList.add("hidden");$(kind+"CamWrap").classList.remove("hidden");
  status(kind,"Camera started. Frame the "+(kind==="board"?"called-number list":"card")+" and tap CAPTURE.");
 }catch(e){status(kind,"Camera could not start: "+e.message+". Choose a photo or use manual entry.")}
}
function deadline(p,ms){return Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Recognition timed out. Use manual entry or retry.")),ms))])}
async function loadOCR(kind){
 if(!workerPromise)workerPromise=(async()=>{
  if(!window.Tesseract)await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";s.onload=resolve;s.onerror=()=>reject(new Error("Recognition library could not load. Check your connection."));document.head.append(s)});
  const w=await deadline(Tesseract.createWorker("eng",1,{logger:m=>{if(busy&&m.status)status(locked?"card":"board","Reading photo: "+m.status+" "+Math.round((m.progress||0)*100)+"%")}}),60000);
  await w.setParameters({tessedit_pageseg_mode:"11"});
  return w;
 })().catch(e=>{workerPromise=null;throw e});
 return workerPromise;
}
function numericWords(data){
 const words=data.words||data.blocks?.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words)))||[];
 return words.map(w=>({n:/^(?:[BINGO]\s*)?(\d{1,2})$/i.exec(w.text.trim()),bbox:w.bbox,confidence:w.confidence}))
 .filter(w=>w.n&&+w.n[1]>=1&&+w.n[1]<=75).map(w=>({...w,n:+w.n[1]}));
}
function cardFromWords(words){
 const out=Array.from({length:5},(_,r)=>Array.from({length:5},(_,c)=>r===2&&c===2?"FREE":null));
 // B-I-N-G-O column ranges identify column membership. Infer rows from each
 // column's vertical order only if exactly five entries (four for N) exist.
 // Missing or extra OCR tokens leave that column blank for manual review.
 for(let c=0;c<5;c++){
  const list=words.filter(w=>w.n>c*15&&w.n<=(c+1)*15&&w.confidence>=35).sort((a,b)=>a.bbox.y0-b.bbox.y0);
  if(list.length!==(c===2?4:5))continue;
  list.forEach((w,i)=>{out[c===2&&i>=2?i+1:i][c]=w.n})
 }return out;
}
async function analyze(kind,img,token){
 status(kind,"Photo captured. Starting recognition…");
 try{
  const w=await loadOCR(kind);if(token!==generation)return;
  const {data}=await w.recognize(img,{}, {text:true,blocks:true});$("ocrText").textContent=data.text||"No text recognized.";if(token!==generation)return;
  const words=numericWords(data);
  if(kind==="board"){
   called=new Set(words.filter(w=>w.confidence>=35).map(w=>w.n));$("boardConfirmed").checked=false;render75();renderPatterns();$("confirmBoard").classList.remove("hidden");
   status(kind,called.size+" candidate numbers read. OCR reads visible digits, not the called/un-called light state. Correct the grid against the TV before locking.");
  }else{
   card=cardFromWords(words);renderCardEditor();
   const count=card.flat().filter(n=>Number.isInteger(n)).length;
   status(kind,count+" of 24 numbers filled. Compare every cell with your photo; fill blanks and fix mistakes before verifying.");
  }
 }catch(e){
  if(token!==generation)return;
  status(kind,"Could not read photo: "+e.message+". You can enter the numbers manually.");
  if(kind==="board"){$("confirmBoard").classList.remove("hidden");render75();renderPatterns()}else renderCardEditor();
 }
}
async function acceptPhoto(kind,src){
 if(busy)return;setBusy(true);const token=++generation;
 try{
  const img=$(kind+"Preview");img.src=src;await img.decode();
  img.classList.remove("hidden");$(kind+"CamWrap").classList.add("hidden");
  if(kind==="card"){$("result").classList.add("hidden");$("cardEditor").classList.add("hidden");card=Array.from({length:5},(_,r)=>Array.from({length:5},(_,c)=>r===2&&c===2?"FREE":null))}
  if(kind==="card"){
   cropPoints=[];$("cropHint").classList.remove("hidden");$("readGrid").classList.remove("hidden");$("readGrid").disabled=true;
   renderCardEditor();status("card","Photo captured. Mark two opposite corners of the number grid on the photo, then tap READ SELECTED CARD GRID.");
  }else await analyze(kind,img,token);
 }catch(e){status(kind,"Photo could not load: "+e.message+". Retake or choose a different photo.")}
 finally{if(token===generation)setBusy(false)}
}
function capture(kind){
 const v=$(kind+"Cam");
 if(!v.videoWidth||!v.videoHeight){status(kind,"No camera frame yet. Tap USE CAMERA and allow access, then tap CAPTURE.");return}
 const c=document.createElement("canvas"),scale=Math.min(1,1800/v.videoWidth);c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);c.getContext("2d").drawImage(v,0,0,c.width,c.height);acceptPhoto(kind,c.toDataURL("image/jpeg",.95));
}
function renderCardEditor(){
 $("cardInputs").replaceChildren();$("cardConfirmed").checked=false;$("cardEditor").classList.remove("hidden");$("result").classList.add("hidden");
 for(let r=0;r<5;r++)for(let c=0;c<5;c++){
  if(r===2&&c===2){const f=document.createElement("div");f.className="cell";f.textContent="FREE";$("cardInputs").append(f);continue}
  const input=document.createElement("input");input.type="number";input.inputMode="numeric";input.min=c*15+1;input.max=(c+1)*15;input.required=true;input.className="cellinput";input.value=card[r][c]??"";input.setAttribute("aria-label","Row "+(r+1)+", "+["B","I","N","G","O"][c]);input.dataset.row=r;input.dataset.col=c;input.oninput=()=>{$("cardConfirmed").checked=false;$("result").classList.add("hidden")};$("cardInputs").append(input);
 }
}
function readCard(){
 const values=Array.from({length:5},()=>Array(5).fill(null));values[2][2]="FREE";const seen=new Set();
 for(const input of $("cardInputs").querySelectorAll("input")){
  const n=Number(input.value),c=Number(input.dataset.col),r=Number(input.dataset.row);
  if(input.value.trim()===""||!Number.isInteger(n)||n<c*15+1||n>(c+1)*15||seen.has(n)){input.focus();throw new Error("Each cell needs a unique number in its B-I-N-G-O range. Check row "+(r+1)+", column "+(c+1)+".")}
  seen.add(n);values[r][c]=n;
 }return values;
}
function patternLines(p){
 const rows=Array.from({length:5},(_,r)=>Array.from({length:5},(_,c)=>[r,c]));
 const cols=Array.from({length:5},(_,c)=>Array.from({length:5},(_,r)=>[r,c]));
 const diagonals=[Array.from({length:5},(_,i)=>[i,i]),Array.from({length:5},(_,i)=>[i,4-i])];
 if(p===pats[0])return rows;if(p===pats[1])return cols;if(p===pats[2])return diagonals;
 if(p===pats[3])return [[[0,0],[0,4],[4,0],[4,4]]];
 if(p===pats[4])return [[...diagonals[0],...diagonals[1].filter(([r])=>r!==2)]];
 if(p===pats[5])return [rows.flat()];if(p===pats[6])return [rows.slice(1,4).map(row=>row.slice(1,4)).flat()];throw new Error("Unknown pattern");
}
function evaluate(values,numbers,p){
 const lines=patternLines(p),hit=([r,c])=>values[r][c]==="FREE"||numbers.has(values[r][c]);
 const winners=lines.filter(line=>line.every(hit));
 const closest=[...lines].sort((a,b)=>b.filter(hit).length-a.filter(hit).length)[0];
 return {winner:winners.length>0,required:winners.length?winners.flat():closest,missing:closest.filter(pos=>!hit(pos)).map(([r,c])=>values[r][c])};
}
function verify(){
 try{
  if(!locked)throw new Error("Confirm and lock the caller numbers first.");
  const values=readCard();if(!$("cardConfirmed").checked)throw new Error("Check every number against the photo, then tick the confirmation box.");
  const verdict=evaluate(values,called,pattern);card=values;
  $("result").replaceChildren();
  const title=document.createElement("div");title.className=verdict.winner?"winner":"loser";title.textContent=verdict.winner?"✓ BINGO!":"NO BINGO";$("result").append(title);
  const note=document.createElement("p");note.className="center";note.textContent=pattern+" — based on the numbers you confirmed."; $("result").append(note);
  const grid=document.createElement("div");grid.className="bcard";
  for(let r=0;r<5;r++)for(let c=0;c<5;c++){const cell=document.createElement("div");const req=verdict.required.some(([rr,cc])=>rr===r&&cc===c),ok=values[r][c]==="FREE"||called.has(values[r][c]);cell.className="cell "+(req?(ok?"good":"bad"):"");cell.textContent=values[r][c];grid.append(cell)}
  $("result").append(grid);
  if(!verdict.winner){const missing=document.createElement("p");missing.textContent="Closest pattern is missing: "+verdict.missing.join(", ");$("result").append(missing)}
  const next=document.createElement("button");next.className="btn dark";next.textContent="SCAN NEXT CARD";next.onclick=()=>{$("result").classList.add("hidden");$("cardEditor").classList.add("hidden");$("cardPreview").classList.add("hidden");$("cardFile").value="";startCamera("card")};$("result").append(next);$("result").classList.remove("hidden");$("result").scrollIntoView({behavior:"smooth"});
 }catch(e){status("card",e.message)}
}

const actualCard=[[7,29,43,52,67],[8,22,38,51,61],[6,19,"FREE",53,62],[3,30,44,55,68],[13,24,31,57,75]];
const required=[22,38,51,19,53,30,44,55];
assert.equal(patternLines(pats[6])[0].length,9);
assert.equal(evaluate(actualCard,new Set(required),pats[6]).winner,true);
for(const n of required){assert.equal(evaluate(actualCard,new Set(required.filter(x=>x!==n)),pats[6]).winner,false,"Missing "+n+" must fail");}
assert.equal(evaluate(actualCard,new Set(required),pats[0]).winner,false);
assert.equal(evaluate(actualCard,new Set(required),pats[5]).winner,false);
console.log("Actual card: center square wins; all eight missing-number cases fail; horizontal and blackout fail.");
