/* ===================== 启动首页 + 壁纸系统 ===================== */
const splash = document.getElementById("splash");
const splashBg = document.getElementById("splashBg");
const wpBtn = document.getElementById("wpBtn");
const wpReset = document.getElementById("wpReset");

/* 隐藏的图片选择器 */
const wallpaperPicker = document.createElement("input");
wallpaperPicker.type = "file";
wallpaperPicker.accept = "image/*";
wallpaperPicker.style.display = "none";
document.body.appendChild(wallpaperPicker);

/* 从 chrome.storage.local 加载已保存的壁纸 */
function loadWallpaper(){
  try{
    if(typeof chrome !== "undefined" && chrome.storage && chrome.storage.local){
      chrome.storage.local.get("splashWallpaper").then(result => {
        if(result && result.splashWallpaper){
          applyWallpaper(result.splashWallpaper);
        }
      }).catch(()=>{});
    }
  }catch(e){}
}

/* 应用壁纸到背景 */
function applyWallpaper(dataUrl){
  splashBg.style.backgroundImage = `url("${dataUrl}")`;
  splash.classList.add("has-wallpaper");
  wpReset.classList.add("show");
}

/* 清除壁纸，恢复默认渐变 */
function clearWallpaper(){
  splashBg.style.backgroundImage = "";
  splash.classList.remove("has-wallpaper");
  wpReset.classList.remove("show");
  try{
    if(typeof chrome !== "undefined" && chrome.storage && chrome.storage.local){
      chrome.storage.local.remove("splashWallpaper").catch(()=>{});
    }
  }catch(e){}
}

/* 壁纸按钮 → 打开图片选择器（阻止冒泡，不触发首页关闭） */
wpBtn.addEventListener("click", (e)=>{
  e.stopPropagation();
  wallpaperPicker.click();
});
wpReset.addEventListener("click", (e)=>{
  e.stopPropagation();
  clearWallpaper();
});

/* 选择图片后 → 存为 dataUrl → 应用 + 持久化 */
wallpaperPicker.addEventListener("change", ()=>{
  const file = wallpaperPicker.files && wallpaperPicker.files[0];
  if(!file) return;
  if(!file.type.startsWith("image/")){
    alert("请选择图片文件（jpg / png / webp 等）。");
    return;
  }
  /* 限制 15MB，避免 storage 超限 */
  if(file.size > 15 * 1024 * 1024){
    alert("图片过大（超过 15MB），请选择更小的图片。");
    return;
  }
  const reader = new FileReader();
  reader.onload = ()=>{
    const dataUrl = reader.result;
    applyWallpaper(dataUrl);
    try{
      if(typeof chrome !== "undefined" && chrome.storage && chrome.storage.local){
        chrome.storage.local.set({ splashWallpaper: dataUrl }).catch(()=>{});
      }
    }catch(e){}
  };
  reader.onerror = ()=>{ alert("读取图片失败，请重试。"); };
  reader.readAsDataURL(file);
  wallpaperPicker.value = "";
});

loadWallpaper();

/* 点击任意位置关闭启动页（壁纸按钮已 stopPropagation，不会误触） */
splash.addEventListener("click", () => {
  splash.classList.add("gone");
  setTimeout(() => { splash.style.display = "none"; }, 600);
});

/* ===================== 状态 ===================== */
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv|ogg|3gp|mts)$/i;
let items = [];          // {name, file, url, thumb}
let list = [];           // 当前过滤后
let cur = -1;
let auto = true;
let search = "";
let soundOn = true;

const video = document.getElementById("video");
const stage = document.getElementById("stage");
const grid = document.getElementById("grid");
const wallScroll = document.getElementById("wallScroll");
const overlay = document.getElementById("overlay");

/* ===================== 选择文件（携带文件句柄，支持右键删除） ===================== */
const filePicker = document.createElement("input");
filePicker.type = "file";
filePicker.multiple = true;
filePicker.accept = "video/*,.mp4,.webm,.mov,.m4v,.ogv,.ogg,.3gp";
filePicker.style.display = "none";
document.body.appendChild(filePicker);
filePicker.addEventListener("change", ()=>{
  const files = Array.from(filePicker.files || []);
  filePicker.value = "";
  if(files.length) acceptFiles(files, null);
});

async function pickFiles(){
  try{
    if(window.showOpenFilePicker){
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description:"视频", accept:{ "video/*":[".mp4",".m4v",".webm",".mov",".ogv",".ogg",".3gp"] } }]
      });
      const files = [], hs = [];
      for(const h of handles){
        try{ files.push(await h.getFile()); hs.push(h); }catch(e){ hs.push(null); }
      }
      if(files.length) acceptFiles(files, hs);
      return;
    }
  }catch(e){
    // 用户取消 → 什么都不做
    if(!e || e.name === "AbortError") return;
    // 其它错误（该环境禁用 File System Access API 等）→ 降级到普通文件选择框
  }
  filePicker.click();   // 普通文件输入：任何环境都能用，但该方式不支持右键删除
}
function bindFilesPick(btnId){ document.getElementById(btnId).addEventListener("click", ()=> pickFiles()); }
bindFilesPick("pickFilesBtn"); bindFilesPick("pickFilesBtn2");

/* 选择文件夹（showDirectoryPicker），获得目录句柄后可删除本地文件 */
document.getElementById("pickDirBtn").addEventListener("click", pickDirectory);

async function pickDirectory(){
  try{
    if(!window.showDirectoryPicker){
      alert("当前浏览器不支持文件夹选择，请使用「选择文件」按钮。");
      return;
    }
    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    const files = [];
    for await (const entry of dirHandle.values()){
      if(entry.kind === "file" && VIDEO_EXT.test(entry.name)){
        try{ files.push(await entry.getFile()); }catch(e){}
      }
    }
    if(!files.length){ alert("该文件夹中没有找到视频文件。"); return; }
    files.sort((a,b) => a.name.localeCompare(b.name, "zh"));
    acceptFiles(files, null, dirHandle);
  }catch(e){
    if(e && e.name === "AbortError") return;
  }
}

/* 拖放：支持单个文件与文件夹 */
function prevent(e){ e.preventDefault(); e.stopPropagation(); }
["dragenter","dragover"].forEach(ev => document.addEventListener(ev, e => { prevent(e); overlay.classList.add("show","dragging"); }));
["dragleave","drop"].forEach(ev => document.addEventListener(ev, e => {
  if(ev==="dragleave" && e.relatedTarget) return;
  prevent(e); overlay.classList.remove("dragging");
}));
document.addEventListener("drop", async e => {
  if(e.target && e.target.closest && e.target.closest("#overlay")) overlay.classList.remove("show");
  const files = [];
  const entries = Array.from(e.dataTransfer && e.dataTransfer.items || []).map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  if(entries.length){ for(const en of entries){ await walkEntry(en, files); } }
  else{
    Array.from(e.dataTransfer.files || []).forEach(f => files.push(f));
  }
  if(files.length) acceptFiles(files, null);
});

function walkEntry(entry, out){
  return new Promise(resolve => {
    if(entry.isFile){
      entry.file(f => { out.push(f); resolve(); }, ()=>resolve());
    } else if(entry.isDirectory){
      const reader = entry.createReader();
      const readAll = () => { reader.readEntries(ents => {
        if(!ents.length) return resolve();
        Promise.all(ents.map(en => walkEntry(en, out))).then(readAll);
      }, ()=>resolve()); };
      readAll();
    } else resolve();
  });
}

/* ===================== 建立播放列表 ===================== */
function acceptFiles(fileList, handles, dirHandle){
  const vid = fileList.filter(f => VIDEO_EXT.test(f.name));
  if(!vid.length){ alert("没有找到可播放的视频文件（mp4/webm/mov 等）。"); return; }

  // 释放旧资源
  items.forEach(it => { if(it.url) URL.revokeObjectURL(it.url); });
  items = vid.map((f,i)=>({ name: f.name, file: f, url: URL.createObjectURL(f), thumb: null,
    handle: handles ? (handles[fileList.indexOf(f)] || null) : null,
    dirHandle: dirHandle || null }));

  overlay.classList.remove("show","dragging");
  list = items.slice();
  renderWall();
  if(list.length) playIndex(0, false);
  document.getElementById("searchInput").focus && document.getElementById("searchInput").blur();
}

/* ===================== 缩略图生成（浏览器端抽帧，懒加载 + 并发上限） ===================== */
const MAX_CONCURRENT = 3;
let activeThumbs = 0;
const thumbQueue = [];

function generateThumb(item){
  if(item.thumb) return;
  thumbQueue.push(item);
  pumpThumbs();
}
function pumpThumbs(){
  while(activeThumbs < MAX_CONCURRENT && thumbQueue.length){
    const it = thumbQueue.shift();
    activeThumbs++;
    doThumb(it).then(()=>{ activeThumbs--; pumpThumbs(); });
  }
}
function doThumb(item){
  return new Promise(resolve => {
    const tv = document.createElement("video");
    tv.muted = true; tv.playsInline = true; tv.preload = "auto";
    let done = false;
    const finish = () => { if(done) return; done = true; try{ tv.removeAttribute("src"); tv.load(); }catch(e){} resolve(); };
    tv.addEventListener("loadeddata", ()=>{
      const target = Math.min(0.6, Math.max(0.05, (tv.duration||10) * 0.08));
      try{ tv.currentTime = target; }catch(e){ finish(); }
    });
    tv.addEventListener("seeked", ()=>{
      try{
        const w = tv.videoWidth, h = tv.videoHeight;
        if(!w || !h){ finish(); return; }
        const cw = 320, ch = Math.max(1, Math.round(320 * h / w));
        const c = document.createElement("canvas"); c.width = cw; c.height = ch;
        c.getContext("2d").drawImage(tv, 0, 0, cw, ch);
        item.thumb = c.toDataURL("image/jpeg", 0.72);
        markThumb(item);
      }catch(e){}
      finish();
    });
    tv.addEventListener("error", finish);
    tv.src = item.url;
    setTimeout(finish, 12000);   // 兜底超时
  });
}
function markThumb(item){
  const card = grid.querySelector(`.card[data-k="${item.key}"]`);
  if(!card) return;
  const img = card.querySelector(".poster");
  const ph = card.querySelector(".ph");
  if(img && item.thumb){ img.src = item.thumb; }
  if(ph) ph.remove();
}

/* ===================== 渲染 ===================== */
function renderWall(){
  const frag = document.createDocumentFragment();
  if(!list.length){
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = search ? "没有匹配「"+search+"」的视频" : "请选择文件或拖入视频";
    frag.appendChild(e);
  } else {
    list.forEach((v, i)=>{
      v.key = v.key || (v.file.name + "_" + (v.file.lastModified||0) + "_" + i);
      const card = document.createElement("div");
      card.className = "card" + (i===cur ? " active" : "");
      card.tabIndex = 0;
      card.dataset.k = v.key;
      card.addEventListener("click", ()=> playIndex(i, true));
      card.addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); playIndex(i,true);} });

      const img = document.createElement("img");
      img.className = "poster"; img.alt = v.name;
      img.loading = "lazy";
      if(v.thumb){ img.src = v.thumb; }

      const ph = document.createElement("span");
      ph.className = "ph";
      ph.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M10 9l5 3-5 3z"/></svg>';

      const seq = document.createElement("span"); seq.className="seq"; seq.textContent = String(i+1);
      const cap = document.createElement("span"); cap.className="cap"; cap.textContent = v.name;

      /* 卡片删除按钮（悬停显示） */
      if(v.handle || v.dirHandle){
        const delBtn = document.createElement("span");
        delBtn.className = "del-btn";
        delBtn.textContent = "\u00d7";
        delBtn.title = "删除本地文件";
        delBtn.addEventListener("click", (ev)=>{
          ev.preventDefault();
          ev.stopPropagation();
          deleteItem(v);
        });
        card.appendChild(delBtn);
      }

      card.appendChild(img); card.appendChild(ph); card.appendChild(seq); card.appendChild(cap);
      frag.appendChild(card);
    });
  }
  grid.replaceChildren(frag);
  document.getElementById("shownCount").textContent = list.length + " 条";
  document.getElementById("nowTotal").textContent = String(list.length);
  observeThumbs();
}
function observeThumbs(){
  grid.querySelectorAll(".card").forEach(card=>{
    const item = list.find(x=>x.key===card.dataset.k);
    if(!item || item.thumb) return;
    thumbObserver.observe(card);
  });
}
const thumbObserver = new IntersectionObserver(entries=>{
  entries.forEach(en=>{
    if(en.isIntersecting){
      thumbObserver.unobserve(en.target);
      const item = list.find(x=>x.key===en.target.dataset.k);
      if(item && !item.thumb) generateThumb(item);
    }
  });
},{root: wallScroll, rootMargin:"120px"});

/* ===================== 播放控制 ===================== */
function playIndex(i, withSound){
  if(i<0 || i>=list.length) return;
  cur = i;
  const v = list[i];
  video.src = v.url;
  if(withSound){ soundOn = true; }
  video.muted = !soundOn;
  syncMuteIcon();
  video.play().then(()=>{ if(!video.muted) hideHint(); }).catch(()=>{
    if(!video.muted){ video.muted = true; syncMuteIcon(); video.play().catch(()=>{}); showHint(); }
  });
  renderMeta(); renderWall(); scrollActive();
}
function next(loop){
  if(!list.length) return;
  const n = cur + 1;
  if(n >= list.length){ if(!loop) playIndex(0,false); return; }
  playIndex(n, false);
}
function prev(){
  if(!list.length) return;
  const p = cur - 1;
  if(p < 0) return;
  playIndex(p, false);
}

function renderMeta(){
  if(cur<0){ document.getElementById("metaIdx").textContent="—"; document.getElementById("fname").textContent="请先选择文件"; return; }
  const v = list[cur];
  document.getElementById("nowIdx").textContent = String(cur+1);
  document.getElementById("nowTotal").textContent = String(list.length);
  document.getElementById("metaIdx").textContent = String(cur+1).padStart(2,"0");
  document.getElementById("fname").textContent = v.name;
  document.getElementById("countInfo").textContent = (cur+1) + " / " + list.length;
}
function scrollActive(){
  const act = grid.querySelector(".card.active");
  if(!act) return;
  const t=act.offsetTop, h=act.offsetHeight, st=wallScroll.scrollTop, vh=wallScroll.clientHeight;
  if(t<st || t+h>st+vh){ wallScroll.scrollTo({top:t-vh/2+h/2, behavior:"smooth"}); }
}

/* ===================== 播放 / 暂停 ===================== */
function syncPlayIcon(){
  const playing = !video.paused && !video.ended;
  document.getElementById("playSvg").innerHTML = playing
    ? '<path d="M6 5h4v14H6zM14 5h4v14H14z"/>'
    : '<path d="M8 5v14l11-7z"/>';
  document.getElementById("playTxt").textContent = playing ? "暂停" : "播放";
}
function togglePlay(){
  if(!list.length) return;
  if(video.paused || video.ended){
    video.play().then(()=>{ if(!video.muted) hideHint(); }).catch(()=>{});
  } else {
    video.pause();
  }
  syncPlayIcon();
}
document.getElementById("playBtn").addEventListener("click", togglePlay);
video.addEventListener("click", togglePlay);   // 点击画面 播放/暂停
video.addEventListener("play", syncPlayIcon);
video.addEventListener("pause", syncPlayIcon);
video.addEventListener("ended", syncPlayIcon);

/* ===================== 底部控制栏 自动显示/隐藏 ===================== */
const playerPanel = document.querySelector(".player-panel");
const bottomUI = document.getElementById("bottomUI");
let uiTimer = null;
function showUI(){ clearTimeout(uiTimer); bottomUI.classList.add("show"); }
function scheduleHideUI(){ clearTimeout(uiTimer); uiTimer = setTimeout(()=> bottomUI.classList.remove("show"), 600); }
playerPanel.addEventListener("mousemove", e=>{
  const r = playerPanel.getBoundingClientRect();
  if(e.clientY - r.top > r.height * 0.56){ showUI(); } else { scheduleHideUI(); }
});
playerPanel.addEventListener("mouseleave", scheduleHideUI);
video.addEventListener("pause", showUI);
video.addEventListener("play", scheduleHideUI);

/* ===================== 播放进度条（拖动跳转任意时间点） ===================== */
const seek = document.getElementById("seek");
const tCur = document.getElementById("tCur");
const tDur = document.getElementById("tDur");
let seeking = false;
let wasPlaying = false;
function fmtTime(t){ if(!isFinite(t) || t<0) return "0:00"; const m=Math.floor(t/60), s=Math.floor(t%60); return m+":"+String(s).padStart(2,"0"); }
function fillSeek(){
  const p = seek.max ? (parseFloat(seek.value)/parseFloat(seek.max)*100) : 0;
  seek.style.background = "linear-gradient(to right, var(--accent) "+p+"%, var(--line) "+p+"%)";
}
function updateSeek(){
  if(seeking) return;
  const d = video.duration || 0;
  seek.max = d;
  seek.value = video.currentTime;
  fillSeek();
  tCur.textContent = fmtTime(video.currentTime);
  tDur.textContent = fmtTime(d);
}
video.addEventListener("timeupdate", updateSeek);
video.addEventListener("loadedmetadata", updateSeek);
video.addEventListener("durationchange", updateSeek);
seek.addEventListener("input", ()=>{
  if(!seeking){ seeking = true; wasPlaying = !video.paused; }
  tCur.textContent = fmtTime(parseFloat(seek.value));
  fillSeek();
});
seek.addEventListener("change", ()=>{
  seeking = false;
  const t = parseFloat(seek.value);
  if(video.duration && isFinite(t)) video.currentTime = Math.min(t, video.duration);
  if(wasPlaying) video.play().catch(()=>{});
  updateSeek();
});

/* ===================== 自动连播 & 声音 ===================== */
video.addEventListener("ended", ()=>{ if(auto) next(true); });
video.addEventListener("error", ()=>{ if(auto) setTimeout(()=>next(true),300); });

const hint = document.getElementById("soundHint");
function showHint(){ hint.hidden = false; }
function hideHint(){ hint.hidden = true; }
function syncMuteIcon(){
  document.getElementById("muteSvg").innerHTML = video.muted
    ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M23 9l-6 6M17 9l6 6"/>'
    : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/><circle cx="11" cy="12" r="2.5"/>';
}
document.getElementById("muteBtn").addEventListener("click", ()=>{
  video.muted = !video.muted; soundOn = !video.muted; syncMuteIcon();
  if(soundOn) hideHint(); else showHint();
});
hint.addEventListener("click", ()=>{ soundOn=true; video.muted=false; syncMuteIcon(); hideHint(); video.play().catch(()=>{}); });

/* ===================== 按钮 & 快捷键 ===================== */
document.getElementById("prevBtn").addEventListener("click", prev);
document.getElementById("nextBtn").addEventListener("click", ()=> next(false));
document.getElementById("autoBtn").addEventListener("click", ()=>{
  auto = !auto;
  document.getElementById("autoTxt").textContent = auto ? "自动连播" : "已暂停";
  document.getElementById("autoBtn").setAttribute("aria-pressed", String(auto));
});
document.getElementById("searchInput").addEventListener("input", e=>{
  search = e.target.value.trim();
  list = search ? items.filter(v=>v.name.toLowerCase().includes(search.toLowerCase())) : items.slice();
  if(cur >= list.length) cur = -1;
  renderWall(); renderMeta();
});
document.addEventListener("keydown", e=>{
  if(e.target && e.target.tagName==="INPUT") return;
  if(e.key===" " || e.key==="Spacebar"){ e.preventDefault(); togglePlay(); return; }
  if(e.key==="ArrowRight"){ e.preventDefault(); next(false); }
  if(e.key==="ArrowLeft"){ e.preventDefault(); prev(); }
  if(e.key==="Enter"){ e.preventDefault(); document.getElementById("autoBtn").click(); }
});

/* ===================== 全屏 ===================== */
const fsBtn = document.getElementById("fsBtn");
const ICON_MAX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const ICON_MIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';
function syncFsIcon(){
  const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
  fsBtn.title = on ? "退出全屏" : "全屏";
  fsBtn.innerHTML = on ? ICON_MIN : ICON_MAX;
}
function toggleFullscreen(){
  if(!(document.fullscreenElement || document.webkitFullscreenElement)){
    if(playerPanel.requestFullscreen) playerPanel.requestFullscreen();
    else if(playerPanel.webkitRequestFullscreen) playerPanel.webkitRequestFullscreen();
  } else {
    if(document.exitFullscreen) document.exitFullscreen();
    else if(document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
}
fsBtn.addEventListener("click", toggleFullscreen);
video.addEventListener("dblclick", toggleFullscreen);   // 双击画面 全屏/退出
document.addEventListener("fullscreenchange", syncFsIcon);
document.addEventListener("webkitfullscreenchange", syncFsIcon);

/* 鼠标滚轮切换视频：在播放画面上，下滚=下一个，上滚=上一个（带防抖） */
let wheelLock = 0;
stage.addEventListener("wheel", e=>{
  e.preventDefault();
  const now = Date.now();
  if(now - wheelLock < 350) return;
  if(e.deltaY > 0){ wheelLock = now; next(false); }
  else if(e.deltaY < 0){ wheelLock = now; prev(); }
}, {passive:false});

/* ===================== 右键删除本地文件 ===================== */
const ctxMenu = document.getElementById("ctxMenu");
const ctxDelete = document.getElementById("ctxDelete");
const ctxCancel = document.getElementById("ctxCancel");
let ctxItem = null;

function showCtx(x, y, item){
  ctxItem = item;
  const canDel = !!(item && (item.handle || item.dirHandle));
  ctxDelete.classList.toggle("off", !canDel);
  ctxDelete.textContent = canDel ? "删除本地文件" : "删除不可用（请用「选择文件夹」载入）";
  ctxMenu.hidden = false;
  const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.max(4, Math.min(x, window.innerWidth - mw - 8)) + "px";
  ctxMenu.style.top  = Math.max(4, Math.min(y, window.innerHeight - mh - 8)) + "px";
}
function hideCtx(){ ctxMenu.hidden = true; }

grid.addEventListener("contextmenu", e=>{
  const card = e.target.closest(".card");
  if(!card) return;
  e.preventDefault();
  const item = list.find(x=>x.key===card.dataset.k);
  if(item) showCtx(e.clientX, e.clientY, item);
});
document.addEventListener("click", ()=>{ if(!ctxMenu.hidden) hideCtx(); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && !ctxMenu.hidden){ e.preventDefault(); hideCtx(); } });

ctxCancel.addEventListener("click", hideCtx);
ctxDelete.addEventListener("click", ()=>{
  hideCtx();
  if(ctxItem) deleteItem(ctxItem);
});

/* 统一删除逻辑：优先用目录句柄，其次文件句柄的 remove()，最后 getParent() */
async function deleteItem(item){
  if(!item) return;
  if(!item.handle && !item.dirHandle){
    alert("该文件不支持删除。请用「选择文件夹」按钮载入视频后再删除。");
    return;
  }
  const name = item.name;
  const ok = confirm("确定删除本地文件？此操作不可恢复。\n\n" + name);
  if(!ok) return;
  try{
    if(item.dirHandle){
      /* 方式一：目录句柄直接删除子条目（选择文件夹载入时） */
      await item.dirHandle.removeEntry(name);
    } else if(item.handle){
      /* 方式二：文件句柄自身的 remove()（Chrome 134+ 新 API） */
      if(typeof item.handle.remove === "function"){
        await item.handle.remove();
      }
      /* 方式三：getParent() 获取父目录再删除（旧 API） */
      else if(typeof item.handle.getParent === "function"){
        const parent = await item.handle.getParent();
        const perm = await parent.requestPermission({mode:"readwrite"});
        if(perm !== "granted"){ alert("未获得写权限，无法删除。请在授权弹窗中选择「允许修改」。"); return; }
        await parent.removeEntry(name);
      }
      else{
        alert("当前浏览器不支持通过文件句柄删除。\n请改用「选择文件夹」按钮载入视频后再删除。");
        return;
      }
    }
  }
  catch(err){ alert("删除失败：" + (err.message || err)); return; }

  const playingItem = (cur>=0) ? list[cur] : null;
  const wasPlayingDeleted = (playingItem === item);
  const idx = items.findIndex(x=>x===item);
  if(idx>=0) items.splice(idx,1);
  if(item.url) URL.revokeObjectURL(item.url);
  list = search ? items.filter(v=>v.name.toLowerCase().includes(search.toLowerCase())) : items.slice();

  if(!list.length){ cur=-1; video.removeAttribute("src"); renderMeta(); renderWall(); return; }
  if(wasPlayingDeleted){ cur = Math.min(cur, list.length-1); playIndex(cur, false); }
  else {
    const ni = list.indexOf(playingItem);
    cur = ni>=0 ? ni : Math.min(cur, list.length-1);
    renderWall(); renderMeta();
  }
}

syncPlayIcon();
renderMeta();
renderWall();
