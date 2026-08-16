/* ============================================================
   灵感图库 · 拍照姿势参考 (PoseBook)
   纯前端 PWA：图片与标签存在你自己的 GitHub 仓库
   ============================================================ */
"use strict";
(() => {
  // ---------- 常量 ----------
  const CFG_KEY = "posebook.cfg.v1";
  const CACHE_KEY = "posebook.data.v1";
  const DATA_PATH = "data/tags.json";
  const PAGE_SIZE = 60;
  const API = "https://api.github.com";
  const RAW = "https://raw.githubusercontent.com";
  // jsDelivr 多镜像，自动切换（国内访问更稳）
  const CDNS = [
    "https://cdn.jsdelivr.net/gh",
    "https://fastly.jsdelivr.net/gh",
    "https://gcore.jsdelivr.net/gh",
    "https://testingcf.jsdelivr.net/gh",
  ];

  // ---------- 六维标签体系 ----------
  const TAXONOMY = [
    {
      key: "wear", name: "服饰",
      tags: ["明制汉服", "唐制汉服", "宋制汉服", "晋制汉服", "马面裙", "汉服", "旗袍", "和服", "常服", "婚纱", "晚礼服", "JK制服", "民族服饰", "古风"],
    },
    {
      key: "scene", name: "场景",
      tags: ["古建", "园林", "宫殿", "寺庙", "书院", "城墙", "街拍", "咖啡馆", "室内", "海边", "森林", "花田", "雪景", "夜景", "山水", "巷弄", "桥", "天台"],
    },
    {
      key: "pose", name: "动作",
      tags: ["站姿", "坐姿", "蹲姿", "躺姿", "行走", "奔跑", "回眸", "侧身", "背影", "仰头", "低头", "伸手", "撑伞", "执扇", "提灯", "抚琴", "提裙", "倚靠", "舞蹈", "跳跃", "手部特写", "局部特写", "互动"],
    },
    {
      key: "angle", name: "角度",
      tags: ["正面", "侧面", "45度", "背面", "俯拍", "仰拍", "平拍", "低机位", "全身", "半身", "特写", "大远景"],
    },
    {
      key: "comp", name: "构图",
      tags: ["居中", "三分法", "对称", "留白", "框架构图", "引导线", "对角线", "前景遮挡", "倒影", "环绕"],
    },
    {
      key: "light", name: "光线",
      tags: ["逆光", "侧光", "顺光", "顶光", "黄金时刻", "蓝调时刻", "剪影", "夜景灯光", "窗户光", "阴天柔光", "霓虹"],
    },
  ];
  const PRESET_TAGS = new Set(TAXONOMY.flatMap((g) => g.tags));

  // ---------- 状态 ----------
  const state = {
    cfg: loadCfg(),
    data: null,
    view: "library",
    query: "",
    selTags: new Set(),
    filtersOpen: false,
    sort: "recent",
    rendered: 0,
    filtered: [],
    lbIndex: -1,
    upload: { files: [], tags: new Set(), rating: 0, source: "", notes: "" },
    lastLoadAt: 0,
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);

  // ---------- 工具 ----------
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  const uid = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const rand = (n) => Math.random().toString(36).slice(2, 2 + n);

  function toast(msg, type = "") {
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.textContent = msg;
    $("toasts").appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .35s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 400);
    }, 2600);
  }

  function download(text, name) {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- 配置 ----------
  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
  }
  function saveCfg() { localStorage.setItem(CFG_KEY, JSON.stringify(state.cfg)); }
  function hasCfg() { return !!(state.cfg.owner && state.cfg.repo && state.cfg.pat); }

  // ---------- GitHub API ----------
  function apiError(status, msg) {
    const e = new Error(msg);
    e.status = status;
    return e;
  }

  async function gh(method, path, body) {
    const { owner, repo, pat } = state.cfg;
    if (!owner || !repo || !pat) throw apiError(401, "未配置 GitHub 连接，请到「设置」填写");
    let res;
    try {
      res = await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${pat}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw apiError(0, "网络请求失败，请检查网络");
    }
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.message || msg; } catch {}
      if (res.status === 401) throw apiError(401, "令牌无效或已过期，请在设置里更新");
      if (res.status === 403) throw apiError(403, "权限不足或触发限流：" + msg);
      if (res.status === 404) throw apiError(404, "仓库或文件不存在：" + msg);
      if (res.status === 409) throw apiError(409, "文件已被其他设备修改（冲突）");
      throw apiError(res.status, msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function b64ToUtf8(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function utf8ToB64(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function bytesToB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function fetchTagsJson() {
    let j;
    try {
      j = await gh("GET", `/contents/${DATA_PATH}`);
    } catch (e) {
      if (e.status === 404) return { text: null, sha: null };
      throw e;
    }
    return { text: b64ToUtf8(j.content), sha: j.sha };
  }

  async function putFile(path, content, message, sha) {
    const body = { message, content: utf8ToB64(content) };
    if (sha) body.sha = sha;
    return gh("PUT", `/contents/${path}`, body);
  }

  async function putImage(path, blob, message) {
    const buf = await blob.arrayBuffer();
    return gh("PUT", `/contents/${path}`, { message, content: bytesToB64(new Uint8Array(buf)) });
  }

  async function deleteRepoFile(path) {
    const j = await gh("GET", `/contents/${path}`);
    await gh("DELETE", `/contents/${path}`, { message: "删除参考图", sha: j.sha });
  }

  function cdnUrl(path, idx = 0) {
    const b = state.cfg.branch || "main";
    return `${CDNS[idx]}/${encodeURIComponent(state.cfg.owner)}/${encodeURIComponent(state.cfg.repo)}@${b}/${path}`;
  }
  function rawUrl(path) {
    const b = state.cfg.branch || "main";
    return `${RAW}/${encodeURIComponent(state.cfg.owner)}/${encodeURIComponent(state.cfg.repo)}/${b}/${path}`;
  }

  // ---------- 数据 ----------
  async function loadData(force = false) {
    if (!state.data) {
      try { const c = localStorage.getItem(CACHE_KEY); if (c) state.data = JSON.parse(c); } catch {}
    }
    const { text } = await fetchTagsJson();
    if (text) {
      state.data = JSON.parse(text);
      localStorage.setItem(CACHE_KEY, text);
    } else if (!state.data) {
      state.data = { version: 1, photos: [] };
    }
    state.lastLoadAt = Date.now();
    setConn(true);
  }

  async function saveData() {
    const { sha } = await fetchTagsJson();
    const out = JSON.stringify({ version: 1, photos: state.data.photos });
    await putFile(DATA_PATH, out, "更新标签", sha);
    localStorage.setItem(CACHE_KEY, out);
    state.lastLoadAt = Date.now();
  }

  let saveTimer = null;
  let saving = false;
  let pendingSave = false;

  function scheduleSave(delay = 450) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(runSave, delay);
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    await runSave();
  }

  async function runSave() {
    if (saving) { pendingSave = true; return; }
    saving = true;
    const hint = $("lb-saved");
    if (hint) hint.textContent = "保存中…";
    try {
      await saveData();
      if (hint) {
        hint.textContent = "已保存 ✓";
        setTimeout(() => { if (hint.textContent === "已保存 ✓") hint.textContent = ""; }, 1600);
      }
    } catch (e) {
      if (e.status === 409) {
        toast("数据在其他设备被修改，已刷新，请重试", "warn");
        try { await loadData(true); renderAll(); } catch {}
      } else {
        toast("保存失败：" + e.message, "error");
      }
    } finally {
      saving = false;
      if (pendingSave) { pendingSave = false; runSave(); }
    }
  }

  // ---------- 图片压缩 ----------
  function compressImage(file, maxSide = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("图片压缩失败"));
        }, "image/jpeg", quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("无法读取图片文件")); };
      img.src = url;
    });
  }

  async function mapPool(items, limit, fn) {
    let idx = 0;
    const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        await fn(items[i], i);
      }
    });
    await Promise.all(workers);
  }

  // ---------- 过滤与排序 ----------
  function filterPhotos() {
    const q = state.query.trim().toLowerCase();
    const tags = state.selTags;
    return state.data.photos.filter((p) => {
      if (tags.size) {
        const pt = p.tags || [];
        for (const t of tags) if (!pt.includes(t)) return false;
      }
      if (q) {
        const hay = [(p.tags || []).join(" "), p.notes, p.source, p.file].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      if (state.sort === "rating") {
        return (b.rating || 0) - (a.rating || 0) || String(b.addedAt || "").localeCompare(String(a.addedAt || ""));
      }
      return String(b.addedAt || "").localeCompare(String(a.addedAt || ""));
    });
  }

  function tagCounts() {
    const m = new Map();
    for (const p of state.data.photos) {
      for (const t of p.tags || []) m.set(t, (m.get(t) || 0) + 1);
    }
    return m;
  }

  // ---------- 渲染：标签面板 ----------
  function makeChip(t, set, opts) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (set.has(t) ? " on" : "");
    chip.textContent = t;
    if (opts.counts && opts.counts.get(t)) {
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = opts.counts.get(t);
      chip.appendChild(n);
    }
    chip.addEventListener("click", () => {
      if (set.has(t)) { set.delete(t); chip.classList.remove("on"); }
      else { set.add(t); chip.classList.add("on"); }
      if (opts.onChange) opts.onChange();
    });
    return chip;
  }

  // 每个标签面板的 UI 状态（折叠 + 搜索词），按面板 id 隔离
  const panelUI = {};
  function getPanelUI(id) {
    if (!panelUI[id]) panelUI[id] = { collapsed: new Set(TAXONOMY.map((g) => g.key)), search: "" };
    return panelUI[id];
  }

  function makeGroup(panelId, key, name, tags, set, opts, ui) {
    const div = document.createElement("div");
    div.className = "tag-group";
    div.dataset.key = key;
    const collapsed = ui.collapsed.has(key) && !ui.search;
    const head = document.createElement("h4");
    head.className = "tg-head" + (collapsed ? " collapsed" : "");
    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.textContent = "▾";
    head.appendChild(arrow);
    const nameSpan = document.createElement("span");
    nameSpan.className = "tg-name";
    nameSpan.textContent = name;
    head.appendChild(nameSpan);
    const selCount = tags.filter((t) => set.has(t)).length;
    if (selCount) {
      const badge = document.createElement("span");
      badge.className = "tg-sel";
      badge.textContent = `已选 ${selCount}`;
      head.appendChild(badge);
    }
    if (opts.counts) {
      const used = tags.filter((t) => (opts.counts.get(t) || 0) > 0).length;
      const span = document.createElement("span");
      span.className = "tg-count";
      span.textContent = `${used}/${tags.length}`;
      head.appendChild(span);
    }
    const body = document.createElement("div");
    body.className = "tg-body" + (collapsed ? " hidden" : "");
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const t of tags) chips.appendChild(makeChip(t, set, opts));
    body.appendChild(chips);
    head.addEventListener("click", () => {
      if (ui.search) return; // 搜索时保持展开
      if (ui.collapsed.has(key)) ui.collapsed.delete(key);
      else ui.collapsed.add(key);
      body.classList.toggle("hidden");
      head.classList.toggle("collapsed");
    });
    div.append(head, body);
    return div;
  }

  function applyTagSearch(el, q) {
    const ui = getPanelUI(el.id);
    const s = (q || "").trim().toLowerCase();
    el.querySelectorAll(".tag-group").forEach((g) => {
      const chips = [...g.querySelectorAll(".chip")];
      if (!s) {
        chips.forEach((c) => (c.style.display = ""));
        g.classList.remove("no-match");
        const collapsed = ui.collapsed.has(g.dataset.key);
        const body = g.querySelector(".tg-body");
        const head = g.querySelector(".tg-head");
        if (body) body.classList.toggle("hidden", collapsed);
        if (head) head.classList.toggle("collapsed", collapsed);
        return;
      }
      let hit = false;
      chips.forEach((c) => {
        const ok = c.textContent.toLowerCase().includes(s);
        c.style.display = ok ? "" : "none";
        if (ok) hit = true;
      });
      g.classList.toggle("no-match", !hit);
      if (hit) {
        const body = g.querySelector(".tg-body");
        const head = g.querySelector(".tg-head");
        if (body) body.classList.remove("hidden");
        if (head) head.classList.remove("collapsed");
      }
    });
  }

  function renderTagGroups(el, set, opts = {}) {
    el.innerHTML = "";
    const ui = getPanelUI(el.id);
    const frag = document.createDocumentFragment();

    if (opts.searchable !== false) {
      const top = document.createElement("div");
      top.className = "tg-toolbar";
      const input = document.createElement("input");
      input.type = "search";
      input.placeholder = "搜标签，如：回眸、逆光";
      input.value = ui.search;
      input.addEventListener("input", () => {
        ui.search = input.value;
        applyTagSearch(el, ui.search);
      });
      const btn = document.createElement("button");
      btn.className = "btn ghost small";
      const allCollapsed = ui.collapsed.size >= TAXONOMY.length;
      btn.textContent = allCollapsed ? "展开全部" : "折叠全部";
      btn.addEventListener("click", () => {
        if (ui.collapsed.size >= TAXONOMY.length) ui.collapsed.clear();
        else TAXONOMY.forEach((g) => ui.collapsed.add(g.key));
        renderTagGroups(el, set, opts);
      });
      top.append(input, btn);
      frag.appendChild(top);
    }

    for (const g of TAXONOMY) {
      frag.appendChild(makeGroup(el.id, g.key, g.name, g.tags, set, opts, ui));
    }
    const custom = [...set].filter((t) => !PRESET_TAGS.has(t));
    if (custom.length) {
      frag.appendChild(makeGroup(el.id, "custom", "自定义", custom, set, opts, ui));
    }
    el.appendChild(frag);

    if (opts.allowCustom !== false) {
      const row = document.createElement("div");
      row.className = "custom-tag-row";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "添加自定义标签，如：明制汉服·飞鱼服";
      input.maxLength = 20;
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "＋";
      const add = () => {
        const v = input.value.trim();
        if (!v) return;
        set.add(v);
        input.value = "";
        if (opts.onChange) opts.onChange();
      };
      btn.addEventListener("click", add);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
      row.append(input, btn);
      el.appendChild(row);
    }

    if (ui.search) applyTagSearch(el, ui.search);
  }

  function renderFilterPanel() {
    renderTagGroups($("tag-groups"), state.selTags, {
      counts: tagCounts(),
      onChange: () => { renderFilterPanel(); renderGrid(true); },
    });
    const n = state.selTags.size;
    $("filter-count").classList.toggle("hidden", n === 0);
    if (n) $("filter-count").textContent = n;
  }

  function renderUploadTags() {
    renderTagGroups($("upload-tag-groups"), state.upload.tags, {
      onChange: () => renderUploadTags(),
    });
  }

  // ---------- 渲染：图库网格 ----------
  function makeCard(p) {
    const fig = document.createElement("figure");
    fig.className = "card";
    fig.dataset.id = p.id;
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = (p.tags || []).join(" ") || "参考图";
    img.src = cdnUrl(p.file);
    let tries = 0;
    img.addEventListener("error", () => {
      tries++;
      if (tries < CDNS.length) img.src = cdnUrl(p.file, tries);
      else if (tries === CDNS.length) img.src = rawUrl(p.file);
      else {
        const fb = document.createElement("div");
        fb.className = "img-fallback";
        fb.textContent = "图片加载失败";
        img.remove();
        fig.appendChild(fb);
      }
    });
    fig.appendChild(img);
    if (!(p.tags || []).length) {
      const b = document.createElement("div");
      b.className = "untagged";
      b.textContent = "未打标";
      fig.appendChild(b);
    }
    const cap = document.createElement("figcaption");
    cap.className = "cap";
    const t = document.createElement("span");
    t.className = "t";
    const tags = p.tags || [];
    t.textContent = tags.length ? tags.slice(0, 2).join(" ") + (tags.length > 2 ? ` +${tags.length - 2}` : "") : "未分类";
    cap.appendChild(t);
    if (p.rating) {
      const r = document.createElement("span");
      r.className = "r";
      r.textContent = "★" + p.rating;
      cap.appendChild(r);
    }
    fig.appendChild(cap);
    return fig;
  }

  function renderGrid(reset = true) {
    if (!state.data) return;
    state.filtered = filterPhotos();
    if (reset) {
      state.rendered = 0;
      $("grid").innerHTML = "";
    }
    const slice = state.filtered.slice(state.rendered, state.rendered + PAGE_SIZE);
    const frag = document.createDocumentFragment();
    for (const p of slice) frag.appendChild(makeCard(p));
    $("grid").appendChild(frag);
    state.rendered += slice.length;
    $("lib-count").textContent = state.data ? `${state.filtered.length} / ${state.data.photos.length} 张` : "";
    const empty = $("lib-empty");
    if (state.filtered.length === 0) {
      empty.classList.remove("hidden");
      if (state.data.photos.length === 0) {
        empty.innerHTML = '<div class="empty-icon">🖼</div><p>还没有照片</p><p class="empty-sub">点下方「上传」把你觉得好看的照片存进来，打上标签，拍摄前就能随时检索姿势参考啦</p>';
      } else {
        empty.innerHTML = '<div class="empty-icon">🔍</div><p>没有匹配的结果</p><p class="empty-sub">试试更换关键词，或清除筛选标签</p>';
      }
    } else {
      empty.classList.add("hidden");
    }
    $("lib-loading").classList.add("hidden");
  }

  function renderAll() {
    renderFilterPanel();
    renderGrid(true);
  }

  // ---------- 大图查看 ----------
  function openLb(idx) {
    if (idx < 0 || idx >= state.filtered.length) return;
    state.lbIndex = idx;
    renderLb();
    $("lightbox").classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  function closeLb() {
    $("lightbox").classList.add("hidden");
    document.body.style.overflow = "";
  }
  function lbStep(d) {
    const n = state.filtered.length;
    if (!n) return;
    state.lbIndex = (state.lbIndex + d + n) % n;
    renderLb();
  }

  function renderStars(el, value, onChange) {
    el.innerHTML = "";
    for (let i = 1; i <= 5; i++) {
      const s = document.createElement("span");
      s.textContent = "★";
      s.dataset.v = String(i);
      if (i <= value) s.classList.add("on");
      s.addEventListener("click", () => {
        const cur = [...el.querySelectorAll(".on")].length;
        const v = cur === i ? 0 : i;
        if (onChange) onChange(v);
      });
      el.appendChild(s);
    }
  }

  function renderLb() {
    const p = state.filtered[state.lbIndex];
    if (!p) return;
    const img = $("lb-img");
    img.style.display = "";
    img.src = cdnUrl(p.file);
    let tries = 0;
    img.onerror = () => {
      tries++;
      if (tries < CDNS.length) img.src = cdnUrl(p.file, tries);
      else if (tries === CDNS.length) img.src = rawUrl(p.file);
      else img.style.display = "none";
    };
    $("lb-counter").textContent = `${state.lbIndex + 1} / ${state.filtered.length}`;
    const renderLbStars = () => {
      renderStars($("lb-stars"), p.rating || 0, (v) => {
        p.rating = v;
        renderLbStars();
        scheduleSave();
        renderGrid(true);
      });
    };
    renderLbStars();
    const set = new Set(p.tags || []);
    const renderLbTags = () => {
      renderTagGroups($("lb-tag-groups"), set, {
        onChange: () => {
          p.tags = [...set];
          scheduleSave();
          renderGrid(true);
          renderLbTags();
        },
      });
    };
    renderLbTags();
    $("lb-notes").value = p.notes || "";
    $("lb-source").value = p.source || "";
  }

  async function deletePhoto() {
    const p = state.filtered[state.lbIndex];
    if (!p) return;
    if (!confirm("确定从图库删除这张照片吗？仓库里的图片文件也会被删除。")) return;
    const idx = state.data.photos.indexOf(p);
    if (idx >= 0) state.data.photos.splice(idx, 1);
    try {
      await deleteRepoFile(p.file);
    } catch { /* 文件可能已不存在，忽略 */ }
    try {
      await saveNow();
    } catch {}
    toast("已删除");
    renderGrid(true);
    if (!state.filtered.length) closeLb();
    else {
      state.lbIndex = Math.min(state.lbIndex, state.filtered.length - 1);
      renderLb();
    }
  }

  // ---------- 上传 ----------
  function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    state.upload.files.push(...files);
    renderUploadPreview();
    $("upload-tag-section").classList.remove("hidden");
  }

  function renderUploadPreview() {
    const el = $("upload-preview");
    el.innerHTML = "";
    state.upload.files.forEach((f, i) => {
      const div = document.createElement("div");
      div.className = "up-item";
      const img = document.createElement("img");
      img.src = URL.createObjectURL(f);
      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "✕";
      del.title = "移除";
      del.addEventListener("click", () => {
        state.upload.files.splice(i, 1);
        URL.revokeObjectURL(img.src);
        renderUploadPreview();
      });
      div.append(img, del);
      el.appendChild(div);
    });
    $("btn-upload").disabled = state.upload.files.length === 0;
  }

  async function uploadAll() {
    const files = state.upload.files;
    if (!files.length) return;
    if (!hasCfg()) { toast("请先在设置里配置 GitHub 连接", "warn"); switchView("settings"); return; }
    $("btn-upload").disabled = true;
    $("upload-progress").classList.remove("hidden");
    $("progress-fill").style.width = "0%";
    const photos = [];
    const total = files.length;
    let done = 0;
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    try {
      await mapPool(files, 2, async (f, i) => {
        const blob = await compressImage(f);
        const name = `${day}_${Date.now()}_${i}_${rand(4)}.jpg`;
        const path = `photos/${name}`;
        await putImage(path, blob, `上传参考图 ${name}`);
        photos.push({
          id: uid(),
          file: path,
          tags: [...state.upload.tags],
          notes: state.upload.notes.trim(),
          source: state.upload.source.trim(),
          rating: state.upload.rating,
          addedAt: new Date().toISOString(),
        });
        done++;
        const pct = Math.round((done / total) * 100);
        $("progress-fill").style.width = pct + "%";
        $("progress-text").textContent = `上传中 ${done}/${total}`;
      });
      state.data.photos.push(...photos);
      await saveNow();
      toast(`已上传 ${photos.length} 张到图库 ✅`);
      state.upload = { files: [], tags: new Set(), rating: 0, source: "", notes: "" };
      $("file-input").value = "";
      $("upload-notes").value = "";
      $("upload-source").value = "";
      renderUploadPreview();
      renderUploadTags();
      $("upload-progress").classList.add("hidden");
      $("upload-tag-section").classList.add("hidden");
      switchView("library");
      renderGrid(true);
    } catch (e) {
      toast("上传失败：" + e.message + "（已上传的图片文件可能仍在仓库，可重新上传）", "error");
    } finally {
      $("btn-upload").disabled = false;
    }
  }

  // ---------- 设置 ----------
  function fillSettings() {
    $("set-owner").value = state.cfg.owner || "";
    $("set-repo").value = state.cfg.repo || "";
    $("set-pat").value = state.cfg.pat || "";
  }

  async function testConn(showResult) {
    const statusEl = $("cfg-status");
    statusEl.className = "cfg-status";
    statusEl.textContent = "连接中…";
    try {
      const j = await gh("GET", "");
      state.cfg.branch = j.default_branch || "main";
      saveCfg();
      statusEl.className = "cfg-status ok";
      statusEl.textContent = `连接成功 ✅ 仓库：${state.cfg.owner}/${state.cfg.repo}（分支 ${state.cfg.branch}）`;
      setConn(true);
      return true;
    } catch (e) {
      statusEl.className = "cfg-status err";
      statusEl.textContent = "连接失败：" + e.message;
      setConn(false);
      if (showResult) toast("连接失败：" + e.message, "error");
      return false;
    }
  }

  function setConn(ok) {
    const el = $("conn-status");
    el.classList.toggle("ok", ok);
    el.textContent = ok ? "已连接" : "未连接";
  }

  // ---------- 视图切换 ----------
  function switchView(name) {
    state.view = name;
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    $("view-" + name).classList.remove("hidden");
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    if (name === "library") {
      renderGrid(true);
      refreshIfStale();
    } else if (name === "upload") {
      renderUploadTags();
      renderUploadPreview();
    } else if (name === "settings") {
      fillSettings();
    }
  }

  async function refreshIfStale() {
    if (!hasCfg()) return;
    if (Date.now() - state.lastLoadAt > 30000) {
      try {
        await loadData(true);
        renderAll();
      } catch { /* 静默失败，继续用缓存 */ }
    }
  }

  // ---------- 事件 ----------
  function bindEvents() {
    // Tab
    document.querySelectorAll(".tab").forEach((t) => {
      t.addEventListener("click", () => switchView(t.dataset.view));
    });
    $("btn-goto-settings").addEventListener("click", () => {
      $("setup-overlay").classList.add("hidden");
      switchView("settings");
    });

    // 图库
    $("search").addEventListener("input", debounce((e) => {
      state.query = e.target.value.trim();
      renderGrid(true);
    }, 250));
    $("sort").addEventListener("change", (e) => { state.sort = e.target.value; renderGrid(true); });
    $("btn-toggle-filters").addEventListener("click", () => {
      $("filter-panel").classList.toggle("hidden");
    });
    $("btn-clear-filters").addEventListener("click", () => {
      state.selTags.clear();
      $("search").value = "";
      state.query = "";
      renderFilterPanel();
      renderGrid(true);
    });
    $("grid").addEventListener("click", (e) => {
      const card = e.target.closest(".card");
      if (!card) return;
      const idx = state.filtered.findIndex((p) => p.id === card.dataset.id);
      if (idx >= 0) openLb(idx);
    });
    window.addEventListener("scroll", () => {
      if (state.view !== "library" || !state.data) return;
      if (state.rendered >= state.filtered.length) return;
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 700) {
        renderGrid(false);
      }
    }, { passive: true });

    // 大图
    $("lb-close").addEventListener("click", closeLb);
    $("lb-backdrop").addEventListener("click", closeLb);
    $("lb-prev").addEventListener("click", () => lbStep(-1));
    $("lb-next").addEventListener("click", () => lbStep(1));
    $("lb-delete").addEventListener("click", deletePhoto);
    $("lb-notes").addEventListener("input", () => {
      const p = state.filtered[state.lbIndex];
      if (!p) return;
      p.notes = $("lb-notes").value;
      scheduleSave();
    });
    $("lb-source").addEventListener("input", () => {
      const p = state.filtered[state.lbIndex];
      if (!p) return;
      p.source = $("lb-source").value;
      scheduleSave();
    });
    document.addEventListener("keydown", (e) => {
      if ($("lightbox").classList.contains("hidden")) return;
      if (e.key === "Escape") closeLb();
      else if (e.key === "ArrowLeft") lbStep(-1);
      else if (e.key === "ArrowRight") lbStep(1);
    });

    // 上传
    $("btn-pick").addEventListener("click", () => $("file-input").click());
    $("file-input").addEventListener("change", (e) => {
      handleFiles(e.target.files);
      e.target.value = "";
    });
    const renderUpStars = () => {
      renderStars($("upload-stars"), state.upload.rating, (v) => {
        state.upload.rating = v;
        renderUpStars();
      });
    };
    renderUpStars();
    $("upload-notes").addEventListener("input", (e) => { state.upload.notes = e.target.value; });
    $("upload-source").addEventListener("input", (e) => { state.upload.source = e.target.value; });
    $("btn-upload").addEventListener("click", uploadAll);

    // 设置
    $("btn-save-cfg").addEventListener("click", async () => {
      state.cfg.owner = $("set-owner").value.trim();
      state.cfg.repo = $("set-repo").value.trim();
      state.cfg.pat = $("set-pat").value.trim();
      saveCfg();
      const ok = await testConn(false);
      if (ok) {
        toast("配置已保存并连接成功");
        try {
          await loadData(true);
          renderAll();
          $("setup-overlay").classList.add("hidden");
          switchView("library");
        } catch (e) { toast("数据加载失败：" + e.message, "error"); }
      } else {
        toast("连接失败，请检查填写内容", "error");
      }
    });
    $("btn-test-cfg").addEventListener("click", () => testConn(true));
    $("btn-export").addEventListener("click", async () => {
      try {
        const { text } = await fetchTagsJson();
        if (!text) throw new Error("仓库里还没有标签数据");
        download(text, `posebook-backup-${new Date().toISOString().slice(0, 10)}.json`);
        toast("已导出备份");
      } catch (e) { toast("导出失败：" + e.message, "error"); }
    });
    $("btn-import").addEventListener("click", () => $("import-input").click());
    $("import-input").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (!confirm("导入将用备份内容覆盖当前标签数据，继续？")) { e.target.value = ""; return; }
      try {
        const text = await f.text();
        const j = JSON.parse(text);
        if (!Array.isArray(j.photos)) throw new Error("文件格式不正确（缺少 photos 数组）");
        state.data = { version: 1, photos: j.photos };
        await saveNow();
        toast("导入成功 ✅");
        renderAll();
      } catch (err) { toast("导入失败：" + err.message, "error"); }
      e.target.value = "";
    });

    // 窗口聚焦时静默刷新
    window.addEventListener("focus", () => refreshIfStale());
  }

  // ---------- 启动 ----------
  async function boot() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    bindEvents();
    if (!hasCfg()) {
      $("setup-overlay").classList.remove("hidden");
      return;
    }
    try {
      await loadData();
      renderAll();
      switchView("library");
    } catch (e) {
      toast("加载失败：" + e.message, "error");
      if (!state.data) $("setup-overlay").classList.remove("hidden");
    }
  }

  boot();
})();
