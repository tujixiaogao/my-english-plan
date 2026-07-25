/* Basic English 850 · 学习应用逻辑 */
(function () {
  "use strict";

  // ---------- 基础工具 ----------
  var LS_KEY = "be850_v1";
  var INTERVALS = [1, 2, 4, 7, 15, 30, 60]; // box -> 间隔天数
  var CATS = ["operations", "general", "thing", "adjective"];

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function addDays(str, n) {
    var d = new Date(str + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ---------- 状态 ----------
  var state = null;
  var currentItem = null; // 当前显示/正在朗读的单词对象
  function defaultState() {
    return {
      version: 1,
      plan: { perDay: 10, startDate: todayLocal() },
      learned: {}, // w -> {box, next, added, last, reps}
      today: { date: "", tasks: [], done: 0, reviewed: 0, newAdded: 0 },
      streak: 0,
      lastActive: "",
      readAll: { idx: 0, round: 1, rounds: 3, done: true }, // 一键朗读断点续读
      personal: [], // 个人单词库（存单词字符串 w）
      settings: { rate: 1, gap: 3, range: "learned", order: "seq", voice: "", showExZh: false, loopListen: false, keepAwake: true, ab: { on: false, a: 1, b: 850 }, readallMode: "all", readallLetter: "A", readallReps: 3 }
    };
  }
  function load() {
    try {
      var s = localStorage.getItem(LS_KEY);
      if (s) return JSON.parse(s);
    } catch (e) {}
    return null;
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ---------- 每日 rollover ----------
  function rollover() {
    var t = todayLocal();
    if (state.today.date === t) return;
    var due = [];
    for (var i = 0; i < WORDS.length; i++) {
      var w = WORDS[i].w;
      var rec = state.learned[w];
      if (rec && rec.next <= t) due.push(w);
    }
    var newW = [];
    for (var j = 0; j < WORDS.length; j++) {
      var ww = WORDS[j].w;
      if (!state.learned[ww]) {
        state.learned[ww] = { box: 0, next: t, added: t, last: null, reps: 0 };
        newW.push(ww);
        if (newW.length >= state.plan.perDay) break;
      }
    }
    state.today = { date: t, tasks: due.concat(newW), done: 0, reviewed: 0, newAdded: newW.length };
    if (state.lastActive) {
      if (state.lastActive === addDays(t, -1)) state.streak += 1;
      else if (state.lastActive !== t) state.streak = 1;
    } else state.streak = 1;
    state.lastActive = t;
    save();
  }

  // ---------- 语音 ----------
  var voices = [];
  function loadVoices() {
    if (!("speechSynthesis" in window)) return;
    voices = speechSynthesis.getVoices() || [];
    var sel = el("set-voice");
    if (!sel) return;
    var cur = state.settings.voice;
    sel.innerHTML = '<option value="">默认</option>';
    voices.forEach(function (v) {
      if (v.lang && (v.lang.toLowerCase().indexOf("en") === 0)) {
        var o = document.createElement("option");
        o.value = v.voiceURI; o.textContent = v.name + " (" + v.lang + ")";
        sel.appendChild(o);
      }
    });
    if (cur) sel.value = cur;
  }
  function pickVoice(prefix) {
    if (state.settings.voice) {
      for (var i = 0; i < voices.length; i++) if (voices[i].voiceURI === state.settings.voice) return voices[i];
    }
    for (var k = 0; k < voices.length; k++) if (voices[k].lang && voices[k].lang.toLowerCase().indexOf(prefix) === 0) return voices[k];
    return null;
  }
  function speak(text, lang, cb) {
    if (!("speechSynthesis" in window)) { if (cb) setTimeout(cb, 0); return; }
    if (text === undefined || text === null || text === "") { if (cb) setTimeout(cb, 0); return; }
    var u = new SpeechSynthesisUtterance(String(text));
    u.lang = lang;
    var r = parseFloat(state.settings.rate) || 1;
    u.rate = lang === "zh-CN" ? r * 0.9 : r;
    var v = pickVoice(lang === "zh-CN" ? "zh" : "en");
    if (v) u.voice = v;
    var finished = false;
    function done() { if (!finished) { finished = true; if (cb) cb(); } }
    u.onend = done;
    u.onerror = done;
    // 关键修复：避免 cancel() 与 speak() 在同一次调用中紧邻执行引发竞态
    // （该竞态会让 Chromium 丢弃新 utterance，造成“朗读没声音”）。
    // 仅当确有朗读正在进行时才 cancel，并延迟一帧（约 60ms）再 speak。
    if (speechSynthesis.speaking || speechSynthesis.pending) {
      try { speechSynthesis.cancel(); } catch (e) {}
      setTimeout(function () { try { speechSynthesis.speak(u); } catch (e) { done(); } }, 60);
    } else {
      try { speechSynthesis.speak(u); } catch (e) { done(); }
    }
    // 兜底：极个别浏览器 onend/onerror 不触发时，超时后继续队列（留出充足余量，避免提前推进）
    var est = Math.max(1500, String(text).length * (lang === "zh-CN" ? 200 : 110) / r) + 2000;
    setTimeout(done, est);
  }
  function speakEn(text, cb) { speak(text, "en-US", cb); }
  function speakZh(text, cb) { speak(text, "zh-CN", cb); }

  // ---------- 离线音频（预生成 mp3，兼容微信/自带浏览器） ----------
  var AUDIO_MAP = {};
  for (var _ai = 0; _ai < WORDS.length; _ai++) AUDIO_MAP[WORDS[_ai].w] = _ai;
  // 全词查找表（跨所有列表），用于个人库/短文按词取对象；离线音频仍只看 AUDIO_MAP
  var ALL_WORD_MAP = {};
  for (var _li = 0; _li < WORD_LISTS.length; _li++) {
    var _ws = (WORD_LISTS[_li].words === WORDS) ? WORDS : WORD_LISTS[_li].words;
    for (var _wi = 0; _wi < _ws.length; _wi++) { if (!ALL_WORD_MAP[_ws[_wi].w]) ALL_WORD_MAP[_ws[_wi].w] = _ws[_wi]; }
  }
  var HAS_AUDIO = true; // 已随应用打包 audio/ 目录
  var phonicsRunId = 0;  // 音标朗读序列号，用于停止/重启动断当前朗读链
  function audioSrc(idx, kind) {
    var s = (kind === "ex") ? "_ex" : (kind === "zh") ? "_zh" : "_w";
    return "audio/" + idx + s + ".mp3";
  }
  function playMp3(url, cb) {
    try {
      var a = new Audio(url);
      currentAudio = a;   // 记录当前播放，便于暂停时立即掐断
      // 应用语速设置
      var rate = parseFloat(state.settings.rate) || 1;
      a.playbackRate = Math.max(0.5, Math.min(2, rate));
      a.onended = function () { if (currentAudio === a) currentAudio = null; if (cb) cb(); };
      a.onerror = function () { if (currentAudio === a) currentAudio = null; if (cb) cb(); };
      var p = a.play();
      if (p && p.catch) p.catch(function () { if (currentAudio === a) currentAudio = null; if (cb) cb(); });
    } catch (e) { if (cb) cb(); }
  }
  var currentAudio = null;
  function stopAudio() {
    if (currentAudio) {
      try {
        currentAudio.onended = null;   // 防止触发后续回调链
        currentAudio.pause();
        currentAudio.currentTime = 0;
      } catch (e) {}
      currentAudio = null;
    }
    try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch (e) {}
  }
  // word: 单词对象或单词字符串；优先播离线音频，否则回退 speechSynthesis
  function sayEnWord(w, cb) {
    var idx = (typeof w === "object") ? AUDIO_MAP[w.w] : AUDIO_MAP[w];
    if (idx !== undefined) { playMp3(audioSrc(idx, "w"), cb); return; }
    var txt = (typeof w === "object") ? w.w : w;
    speakEn(txt, cb);
  }
  function sayExample(w, cb) {
    var idx = (typeof w === "object") ? AUDIO_MAP[w.w] : AUDIO_MAP[w];
    if (idx !== undefined && w && w.ex) { playMp3(audioSrc(idx, "ex"), cb); return; }
    var txt = (typeof w === "object") ? w.ex : w;
    if (txt) speakEn(txt, cb); else if (cb) cb();
  }
  function sayZh(w, cb) {
    var idx = (typeof w === "object") ? AUDIO_MAP[w.w] : AUDIO_MAP[w];
    if (idx !== undefined) { playMp3(audioSrc(idx, "zh"), cb); return; }
    var txt = (typeof w === "object") ? w.zh : w;
    speakZh(txt, cb);
  }
  // 词性中文播报：朗读完单词后，念一遍词性（如「动词」），再念中文释义
  var POS_ZH = { "v.": "动词", "n.": "名词", "adj.": "形容词", "adv.": "副词",
                 "aux.": "助动词", "conj.": "连词", "det.": "限定词",
                 "prep.": "介词", "pron.": "代词" };
  var POS_CODE = { "v.": "v", "n.": "n", "adj.": "adj", "adv.": "adv",
                   "aux.": "aux", "conj.": "conj", "det.": "det",
                   "prep.": "prep", "pron.": "pron" };
  function sayPosZh(w, cb) {
    var item = (typeof w === "object") ? w : null;
    var code = item && item.pos ? POS_CODE[item.pos] : null;
    if (!code) { if (cb) cb(); return; }
    var mp3 = "audio/pos_" + code + ".mp3";
    playMp3(mp3, cb);  // 离线音频；若加载失败 onerror 也会回调继续
  }

  // ---------- 屏幕常亮（Wake Lock API） ----------
  var wakeLockObj = null;
  function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        navigator.wakeLock.request("screen").then(function (wl) {
          wakeLockObj = wl;
          wl.addEventListener("release", function () { wakeLockObj = null; });
        }).catch(function () {});
      }
    } catch (e) {}
  }
  function releaseWakeLock() {
    try { if (wakeLockObj) { wakeLockObj.release(); wakeLockObj = null; } } catch (e) {}
  }
  document.addEventListener("visibilitychange", function () {
    if (wakeLockObj === null && document.visibilityState === "visible" && (readAllPlaying || listenPlaying) && state.settings.keepAwake) {
      requestWakeLock();
    }
  });

  // ---------- 媒体会话（息屏/锁屏控制，提升后台播放概率） ----------
  function msSetState(playing) {
    try { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused"; } catch (e) {}
  }
  function msSetMeta(item) {
    try {
      if (!("mediaSession" in navigator) || !("MediaMetadata" in window) || !item) return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.w + (item.ipa ? "  " + item.ipa : ""),
        artist: item.zh || "",
        album: "Basic English 850",
        artwork: [{ src: "icon-512.png", sizes: "512x512", type: "image/png" }]
      });
    } catch (e) {}
  }
  function msSetup() {
    try {
      if (!("mediaSession" in navigator) || !navigator.mediaSession.setActionHandler) return;
      navigator.mediaSession.setActionHandler("play", function () {
        if (!readAllPlaying && !listenPlaying) startReadAll();
      });
      navigator.mediaSession.setActionHandler("pause", function () {
        if (readAllPlaying) stopReadAll(false);
        else if (listenPlaying) toggleListen();
      });
    } catch (e) {}
  }

  // ---------- 小短文复习 ----------
  var passageSentences = [];
  var passagePlaying = false, passageTokens = [], passageIdx = 0, passageTimer = null;
  // 模板：焦点词按词性填入 {W}，中文释义填入 {ZH}；粘合词均为 850 基础词，保证有离线音频
  var PASSAGE_TEMPLATES = {
    "n.": [
      { en: "I see the {W}.", zh: "我看见那个{ZH}。" },
      { en: "I have the {W}.", zh: "我有那个{ZH}。" },
      { en: "I like the {W}.", zh: "我喜欢那个{ZH}。" },
      { en: "You see the {W}.", zh: "你看见那个{ZH}。" },
      { en: "The {W} and the book.", zh: "那个{ZH}和书。" },
      { en: "The {W} with the dog.", zh: "那个{ZH}和狗在一起。" }
    ],
    "v.": [
      { en: "I {W} the dog.", zh: "我{ZH}那只狗。" },
      { en: "You {W} the book.", zh: "你{ZH}那本书。" },
      { en: "He will {W} the cat.", zh: "他会{ZH}那只猫。" },
      { en: "I {W} to the water.", zh: "我{ZH}去水边。" },
      { en: "I will {W} every day.", zh: "我每天都会{ZH}。" }
    ],
    "adj.": [
      { en: "I have a {W} dog.", zh: "我有一只{ZH}的狗。" },
      { en: "I like the {W} house.", zh: "我喜欢那座{ZH}的房子。" },
      { en: "The {W} book and the table.", zh: "那本{ZH}的书和桌子。" },
      { en: "A {W} cat.", zh: "一只{ZH}的猫。" }
    ],
    "adv.": [
      { en: "I walk {W}.", zh: "我{ZH}地走。" },
      { en: "He will run {W}.", zh: "他会跑得{ZH}。" },
      { en: "I talk {W}.", zh: "我{ZH}地说话。" },
      { en: "You go {W}.", zh: "你{ZH}地去。" }
    ]
  };
  function getWordObj(w) { return ALL_WORD_MAP[w] || null; }
  // 根据模式字符串返回词数组（支持 "wl:listId" / "all" / "learned" / "personal" 等）
  function getWordsByMode(mode) {
    if (mode && mode.indexOf("wl:") === 0) {
      var lid = mode.substring(3);
      if (lid === "all") {
        // 合并所有列表去重
        var seen = {}, merged = [];
        for (var li = 0; li < WORD_LISTS.length; li++) {
          var ws = (WORD_LISTS[li].words === WORDS) ? WORDS : WORD_LISTS[li].words;
          for (var i = 0; i < ws.length; i++) {
            if (!seen[ws[i].w]) { seen[ws[i].w] = true; merged.push(ws[i]); }
          }
        }
        return merged;
      }
      for (var j = 0; j < WORD_LISTS.length; j++) {
        if (WORD_LISTS[j].id === lid) return (WORD_LISTS[j].words === WORDS) ? WORDS : WORD_LISTS[j].words;
      }
      return WORDS; // fallback
    }
    return WORDS; // fallback for "all" and other legacy modes
  }
  function passagePool() {
    var mode = el("passage-source") ? el("passage-source").value : "all";
    var pool = [];
    if (mode && mode.indexOf("wl:") === 0) {
      pool = getWordsByMode(mode).slice();
    } else if (mode === "personal") {
      (state.personal || []).forEach(function (w) { var o = getWordObj(w); if (o) pool.push(o); });
    } else if (mode === "learned") {
      for (var k in state.learned) { if (state.learned[k]) { var o = getWordObj(k); if (o) pool.push(o); } }
    } else { pool = WORDS.slice(); }
    return pool.filter(function (w) { return PASSAGE_TEMPLATES[w.pos]; });
  }
  function shuffleArr(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function genPassage() {
    var mode = el("passage-source") ? el("passage-source").value : "all";
    if (mode === "friends") { renderFriendsPassage(); return; }
    var usable = passagePool();
    if (!usable.length) {
      el("passage-list").innerHTML = '<div class="msg">该来源暂无可生成短文的词（需名词/动词/形容词/副词）。先去学习或加入个人库吧。</div>';
      el("passage-status").textContent = "无可用词";
      passageSentences = [];
      return;
    }
    var count = parseInt((el("passage-count") ? el("passage-count").value : "6"), 10) || 6;
    count = Math.max(3, Math.min(count, usable.length));
    usable = shuffleArr(usable.slice()).slice(0, count);
    var sents = [];
    usable.forEach(function (w) {
      var tmpls = PASSAGE_TEMPLATES[w.pos];
      var tpl = tmpls[Math.floor(Math.random() * tmpls.length)];
      sents.push({ en: tpl.en.replace("{W}", w.w), zh: tpl.zh.replace("{ZH}", w.zh), w: w });
    });
    passageSentences = sents;
    renderPassage(sents);
  }
  function renderPassage(sents) {
    var showZh = state.settings.passageShowZh !== false;
    var html = "";
    sents.forEach(function (s) {
      var enEsc = esc(s.en);
      var re = new RegExp("\\b" + s.w.w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
      enEsc = enEsc.replace(re, '<b class="focus">$&</b>');
      var zhEsc = esc(s.zh);
      html += '<div class="ps-item">' +
        '<div class="ps-en">' + enEsc + '</div>' +
        '<div class="ps-zh' + (showZh ? '' : ' hidden') + '">' + zhEsc + '</div>' +
        '</div>';
    });
    el("passage-list").innerHTML = html;
    el("passage-status").textContent = "已生成 " + sents.length + " 句 · 点「🔊 朗读全文」逐词听";
  }
  // ---------- 老友记 S01E01 分角色剧本 ----------
  function renderFriendsPassage() {
    // 设置朗读数据源（整集按行顺序），供「朗读全文」使用
    passageSentences = (typeof FRIENDS_LINES !== "undefined") ? FRIENDS_LINES.map(function (l) { return { en: l.en, w: null }; }) : [];
    // 合并相邻同角色的行，便于阅读
    var blocks = [];
    (FRIENDS_LINES || []).forEach(function (l) {
      var last = blocks[blocks.length - 1];
      if (last && last.who === l.who) last.lines.push(l.en);
      else blocks.push({ who: l.who, lines: [l.en] });
    });
    var html = "";
    blocks.forEach(function (b, bi) {
      var color = (typeof FRIENDS_CHAR_COLOR !== "undefined" && FRIENDS_CHAR_COLOR[b.who]) || "#b2bec3";
      html += '<div class="fr-block" style="margin:12px 0">';
      html += '<div style="font-weight:700;color:' + color + ';font-size:13px;margin-bottom:2px">' + esc(b.who) + '</div>';
      b.lines.forEach(function (t, ti) {
        var gid = bi + "-" + ti;
        html += '<div class="fr-line" data-en="' + esc(t) + '" data-gid="' + gid + '" style="border-left-color:' + color + '">' +
          '<span class="fr-text">' + esc(t) + '</span>' +
          '<span class="fr-speak">🔊</span>' +
          '</div>';
      });
      html += '</div>';
    });
    el("passage-list").innerHTML = html;
    el("passage-status").textContent = "共 " + (FRIENDS_LINES ? FRIENDS_LINES.length : 0) + " 句 · 点任意一句可单独朗读，或点「🔊 朗读全文」连播";
    if (typeof FRIENDS_META !== "undefined") el("friends-meta").textContent = FRIENDS_META.title + "（" + FRIENDS_META.source + "）";
    // 绑定单行点击朗读
    var frLines = el("passage-list").querySelectorAll(".fr-line");
    for (var i = 0; i < frLines.length; i++) {
      frLines[i].addEventListener("click", function () {
        if (passagePlaying) stopPassage();
        speakEn(this.getAttribute("data-en"));
        var self = this;
        self.classList.add("playing");
        setTimeout(function () { self.classList.remove("playing"); }, 1200);
      });
    }
    renderFriendsVocab();
  }
  function renderFriendsVocab() {
    var wrap = el("friends-wrap"); if (!wrap) return;
    wrap.style.display = "block";
    var vocab = (typeof FRIENDS_VOCAB !== "undefined") ? FRIENDS_VOCAB : [];
    var filter = el("friends-vocab-filter") ? el("friends-vocab-filter").value : "all";
    var q = (el("friends-vocab-search") ? el("friends-vocab-search").value : "").trim().toLowerCase();
    var list = vocab.filter(function (v) {
      if (filter === "known" && !v.known) return false;
      if (filter === "new" && v.known) return false;
      if (q && v.w.indexOf(q) < 0) return false;
      return true;
    });
    var html = "";
    list.slice(0, 400).forEach(function (v) {  // 最多渲染 400 个，避免卡顿
      html += '<span class="vocab-chip' + (v.known ? '' : ' new') + '" data-w="' + esc(v.w) + '">' +
        esc(v.w) + '<span class="vn">' + v.n + '</span>' +
        (v.known ? '' : '<span class="vtag">新</span>') + '</span>';
    });
    el("friends-vocab").innerHTML = html || '<span class="muted">无匹配单词</span>';
    el("friends-vocab-count").textContent = list.length + " / " + vocab.length + " 词";
    var chips = el("friends-vocab").querySelectorAll(".vocab-chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener("click", function () {
        var w = this.getAttribute("data-w");
        sayEnWord(w, null);  // 优先离线音频，否则浏览器 TTS
        this.style.borderColor = "var(--blue)";
        var self = this;
        setTimeout(function () { self.style.borderColor = ""; }, 600);
      });
    }
  }
  function buildPassageTokens() {
    var toks = [];
    passageSentences.forEach(function (s) {
      s.en.split(/\s+/).forEach(function (raw) {
        var w = raw.replace(/[^A-Za-z']/g, "").toLowerCase();
        if (!w) return;
        var idx = AUDIO_MAP[w];
        if (idx !== undefined) toks.push({ type: "mp3", url: audioSrc(idx, "w") });
        else if ("speechSynthesis" in window) toks.push({ type: "speak", text: raw });
        else toks.push({ type: "gap", ms: 80 });
      });
      toks.push({ type: "gap", ms: 480 });
    });
    return toks;
  }
  function playPassage() {
    if (passagePlaying) { stopPassage(); return; }
    if (!passageSentences || !passageSentences.length) { genPassage(); if (!passageSentences || !passageSentences.length) return; }
    if (state.settings.keepAwake) requestWakeLock();
    passageTokens = buildPassageTokens();
    passageIdx = 0; passagePlaying = true;
    el("passage-play").textContent = "⏸ 停止";
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    playPassageToken();
  }
  function playPassageToken() {
    if (!passagePlaying) return;
    if (passageIdx >= passageTokens.length) {
      passagePlaying = false;
      el("passage-play").textContent = "🔊 朗读全文";
      el("passage-status").textContent = "朗读完成 ✓";
      releaseWakeLock();
      return;
    }
    var tok = passageTokens[passageIdx];
    if (tok.type === "mp3") {
      playMp3(tok.url, function () { passageIdx++; passageNext(0); });
    } else if (tok.type === "speak") {
      speakEn(tok.text, function () { passageIdx++; passageNext(60); });
    } else {
      passageIdx++; passageNext(tok.ms);
    }
  }
  function passageNext(extra) {
    if (!passagePlaying) return;
    passageTimer = setTimeout(function () { passageTimer = null; playPassageToken(); }, 110 + extra);
  }
  function stopPassage() {
    passagePlaying = false;
    if (passageTimer) { clearTimeout(passageTimer); passageTimer = null; }
    stopAudio();
    el("passage-play").textContent = "🔊 朗读全文";
    el("passage-status").textContent = "已暂停";
    releaseWakeLock();
  }

  // ---------- 路由 ----------
  function showView(name) {
    var views = document.querySelectorAll(".view");
    for (var i = 0; i < views.length; i++) views[i].classList.remove("active");
    el("view-" + name).classList.add("active");
    var tabs = document.querySelectorAll(".tab");
    for (var k = 0; k < tabs.length; k++) tabs[k].classList.remove("on");
    var t = document.querySelector('.tab[data-view="' + name + '"]');
    if (t) t.classList.add("on");
    // 返回主界面按钮：除首页(学习)外，其余视图都显示
    var bh = el("back-home");
    if (bh) bh.classList.toggle("hidden", name === "learn");
    if (name === "words") renderWords();
    if (name === "stats") renderStats();
    if (name === "pos") renderPos();
    if (name === "passage") {
      var isFr = el("passage-source") && el("passage-source").value === "friends";
      var fw2 = el("friends-wrap"); if (fw2) fw2.style.display = isFr ? "block" : "none";
      if (!passageSentences.length || isFr) genPassage();
    } else if (passagePlaying) {
      stopPassage();
    }
  }

  // ---------- 学习视图 ----------
  function renderLearn() {
    var t = state.today;
    var total = t.tasks.length;
    var done = t.done;
    el("learn-count").textContent = done + " / " + total;
    el("learn-streak").textContent = "🔥 连续 " + state.streak + " 天";
    el("learn-bar").style.width = (total ? Math.round((done / total) * 100) : 0) + "%";

    var area = el("learn-area");
    if (total === 0) {
      area.innerHTML = '<div class="msg">🎉 全部学完啦！去「听学」复习，或在「词库」温故。</div>';
      return;
    }
    if (done >= total) {
      area.innerHTML =
        '<div class="done-badge">✅ 今日任务完成！<br>新学 ' + t.newAdded + " 词，复习 " + (total - t.newAdded) + " 词</div>" +
        '<button class="btn-primary" style="width:100%" onclick="__be.reviewMore()">再复习几个薄弱词</button>';
      return;
    }
    var w = (function () {
      for (var i = 0; i < WORDS.length; i++) if (WORDS[i].w === t.tasks[done]) return WORDS[i];
      return null;
    })();
    if (!w) { done++; save(); return renderLearn(); }
    var rec = state.learned[w.w] || {};
    area.innerHTML =
      '<div class="flashcard" id="fc">' +
        '<div class="inner">' +
          '<div class="face front"><div class="word-en">' + esc(w.w) + '</div>' +
            '<div class="word-ipa">' + esc(w.ipa) + '</div>' +
            '<div style="margin-top:14px"><button class="icon-btn btn-primary" id="fc-spk">🔊</button></div>' +
            '<div class="muted" style="margin-top:10px">点击卡片看释义</div></div>' +
          '<div class="face back"><div class="word-zh">' + esc(w.zh) + '</div>' +
            '<span class="word-pos">' + esc(w.pos) + '</span>' +
            '<div class="word-ex">' + esc(w.ex) + '</div>' +
            '<div style="margin-top:12px"><button class="icon-btn btn-primary" id="fc-spk2">🔊</button></div></div>' +
        '</div></div>' +
      '<div class="row two">' +
        '<button id="btn-dont" style="border-color:#f0c4cf;color:#993556">😅 还不熟</button>' +
        '<button id="btn-know" class="btn-green">👍 认识了</button>' +
      '</div>';

    el("fc").addEventListener("click", function (e) {
      if (e.target.id === "fc-spk" || e.target.id === "fc-spk2") return;
      el("fc").classList.toggle("flipped");
    });
    el("fc-spk").addEventListener("click", function (e) { e.stopPropagation(); sayEnWord(w); });
    el("fc-spk2").addEventListener("click", function (e) {
      e.stopPropagation();
      sayEnWord(w, function () {
        sayExample(w, function () { if ("speechSynthesis" in window) speakZh(w.zh); });
      });
    });
    el("btn-know").addEventListener("click", function () { grade(w.w, true); });
    el("btn-dont").addEventListener("click", function () { grade(w.w, false); });
  }

  function grade(w, known) {
    var rec = state.learned[w];
    if (!rec) rec = state.learned[w] = { box: 0, next: todayLocal(), added: todayLocal(), last: null, reps: 0 };
    rec.reps = (rec.reps || 0) + 1;
    rec.last = todayLocal();
    if (known) {
      rec.box = Math.min(rec.box + 1, INTERVALS.length - 1);
      rec.next = addDays(todayLocal(), INTERVALS[rec.box]);
    } else {
      rec.box = 0;
      rec.next = addDays(todayLocal(), 1);
    }
    state.today.done += 1;
    if (known) state.today.reviewed += 1;
    save();
    renderLearn();
  }

  window.__be = window.__be || {};
  window.__be.reviewMore = function () {
    // 挑 box<=1 的薄弱词加入今日任务
    var weak = [];
    for (var i = 0; i < WORDS.length; i++) {
      var w = WORDS[i].w, rec = state.learned[w];
      if (rec && rec.box <= 1) weak.push(w);
    }
    if (!weak.length) { alert("暂时没有特别薄弱的词，做得很好！"); return; }
    state.today.tasks = state.today.tasks.concat(weak.slice(0, 20));
    save();
    renderLearn();
    showView("learn");
  };

  // ---------- 词库视图（多列表可折叠） ----------
  var curFilter = "all";
  var curSearch = "";
  var expandedLists = { be850: true };
  function wordItemHtml(w) {
    var learned = state.learned[w.w];
    var mark = learned ? (learned.box >= 4 ? "✅" : "●") : "○";
    var pin = inPersonal(w.w) ? "★" : "☆";
    return '<div class="word-item">' +
      '<div class="wi-en">' + esc(w.w) + "</div>" +
      '<div class="wi-ipa">' + esc(w.ipa || "") + "</div>" +
      '<div class="wi-zh">' + esc(w.zh || "") + "</div>" +
      '<div class="wi-cat">' + mark + "</div>" +
      '<button class="icon-btn" data-spk="' + esc(w.w) + '">🔊</button>' +
      '<button class="icon-btn" data-personal="' + esc(w.w) + '">' + pin + "</button>" +
      "</div>";
  }
  function renderWords() {
    var q = curSearch.trim().toLowerCase();
    var html = "";
    if (q) {
      var shown = 0;
      for (var li = 0; li < WORD_LISTS.length; li++) {
        var L = WORD_LISTS[li];
        var ws = (L.words === WORDS) ? WORDS : L.words;
        for (var i = 0; i < ws.length; i++) {
          var w = ws[i];
          if (w.w.toLowerCase().indexOf(q) === -1 && (w.zh || "").indexOf(curSearch.trim()) === -1) continue;
          html += wordItemHtml(w);
          if (++shown >= 400) { html += '<div class="muted center" style="padding:10px">…仅显示前 400 条，请缩小搜索</div>'; break; }
        }
        if (shown >= 400) break;
      }
      if (!html) html = '<div class="msg">没有匹配的词</div>';
    } else {
      for (var li = 0; li < WORD_LISTS.length; li++) {
        var L = WORD_LISTS[li];
        var n = (L.words === WORDS) ? WORDS.length : L.words.length;
        var open = !!expandedLists[L.id];
        html += '<div class="list-group">';
        html += '<div class="list-head" data-list="' + L.id + '">' +
          '<span class="lh-name">' + esc(L.name) + "</span>" +
          '<span class="lh-sub">' + esc(L.sub || "") + "</span>" +
          '<span class="lh-count">' + n + " 词</span>" +
          '<span class="lh-arrow">' + (open ? "▾" : "▸") + "</span></div>";
        if (open) {
          var ws = (L.words === WORDS) ? WORDS : L.words;
          var limit = 600;
          for (var i = 0; i < ws.length && i < limit; i++) html += wordItemHtml(ws[i]);
          if (ws.length > limit) html += '<div class="muted center">…仅显示前 ' + limit + ' 词，用搜索查看全部</div>';
        }
        html += "</div>";
      }
    }
    el("word-list").innerHTML = html;
  }

  // ---------- 听学视图 ----------
  var listenList = [], listenIdx = 0, listenPlaying = false, listenTimer = null;
  function listenSave() {
    state.listen = { idx: listenIdx, range: state.settings.range || "all", done: !listenPlaying };
    save();
  }
  function buildListenList() {
    var range = state.settings.range, list = [];
    if (range && range.indexOf("wl:") === 0) {
      list = getWordsByMode(range).slice();
    } else if (range === "learned") {
      var src = WORDS;
      for (var i = 0; i < src.length; i++) if (state.learned[src[i].w]) list.push(src[i]);
    } else if (range === "today") {
      state.today.tasks.forEach(function (id) {
        var o = getWordObj(id); if (o) list.push(o);
      });
    } else list = WORDS.slice();
    if (state.settings.order === "shuffle") {
      for (var a = list.length - 1; a > 0; a--) {
        var b = Math.floor(Math.random() * (a + 1));
        var tmp = list[a]; list[a] = list[b]; list[b] = tmp;
      }
    }
    return list;
  }
  function setListenDisplay(item) {
    currentItem = item || null;
    refreshPersonalBtn();
    el("lc-en").textContent = item ? item.w : "—";
    // 词性标签（蓝色小圆角标签）
    var posEl = el("lc-pos");
    if (item && item.pos) {
      posEl.textContent = item.pos;
      posEl.style.display = "";
    } else {
      posEl.style.display = "none";
    }
    el("lc-ipa").textContent = item ? item.ipa : "";
    el("lc-zh").textContent = item ? item.zh : "";
    el("lc-ex").textContent = item ? item.ex : "";
    // 例句中文翻译（默认隐藏，由“显示例句中文”按钮控制）
    var zhEl = el("lc-ex-zh");
    if (item && typeof EX_ZH !== "undefined" && EX_ZH.length > AUDIO_MAP[item.w]) {
      zhEl.textContent = EX_ZH[AUDIO_MAP[item.w]] || "";
    } else {
      zhEl.textContent = "";
    }
    zhEl.classList.toggle("show", !!state.settings.showExZh && !!zhEl.textContent);
    if (item) msSetMeta(item);
    updateNavInfo();
  }
  function setStage(s) { el("lc-stage").textContent = s || ""; }
  function listenTick() {
    if (!listenPlaying) return;
    if (!listenList.length) { el("listen-status").textContent = "该范围暂无词，先去学习吧"; return; }
    if (listenIdx >= listenList.length) {
      // 循环播放关闭：播一遍后停止；开启：回到开头重播
      if (!state.settings.loopListen) {
        listenPlaying = false;
        updateBigPlayButton();
        el("listen-status").textContent = "播放完成 ✓";
        listenSave();  // 标记已完成
        releaseWakeLock();
        updateModeButtons();
        updateNavInfo();
        return;
      }
      listenIdx = 0;
    }
    var item = listenList[listenIdx];
    setListenDisplay(item);
    el("listen-status").textContent = "正在播放 " + (listenIdx + 1) + " / " + listenList.length;
    updateListenHint();
    // 对一个单词循环朗读「单词→词性→中文→例句」N 遍，再下一个（N=每词朗读次数）
    var reps = parseInt(state.settings.readallReps, 10) || 3;
    playSeqReps(item, reps, function () {
      listenIdx++;
      listenSave();  // 每词后保存断点，刷新不丢进度
      listenTimer = setTimeout(function () { listenTimer = null; listenTick(); }, state.settings.gap * 1000);
    });
  }
  // 两个朗读模式互斥：激活其中一个时，禁用另一个的播放按钮，避免互相串台
  // 注意：大按钮 #listen-play 是通用播放/暂停，永不禁用（见 updateBigPlayButton）
  function updateModeButtons() {
    var rp = el("readall-play");
    if (readAllPlaying) {
      if (rp) { rp.disabled = false; rp.style.opacity = "1"; rp.title = ""; }
    } else if (listenPlaying) {
      if (rp) { rp.disabled = true; rp.style.opacity = ".45"; rp.title = "每日听学进行中，请先停止"; }
    } else {
      if (rp) { rp.disabled = false; rp.style.opacity = "1"; rp.title = ""; }
    }
    updateBigPlayButton();
  }
  // 大按钮统一状态：▶ = 无播放 / ⏸ = 任一模式在播
  function updateBigPlayButton() {
    var bp = el("listen-play");
    if (!bp) return;
    var active = readAllPlaying || listenPlaying;
    bp.textContent = active ? "⏸" : "▶";
    bp.disabled = false;
    bp.style.opacity = "1";
    bp.title = active ? "点击暂停" : "点击开始听学";
  }
  // 大按钮点击：智能分发到对应模式
  function onBigPlayClick() {
    if (readAllPlaying) { stopReadAll(false); return; }
    if (listenPlaying) { toggleListen(); return; }
    // 都没在播 → 启动听学模式
    toggleListen();
  }
  function toggleListen() {
    if (listenPlaying) {
      listenPlaying = false;
      if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
      stopAudio();   // 立即掐断当前音频
      updateBigPlayButton();
      el("listen-status").textContent = "已暂停";
      listenSave();  // 暂停时保存进度
      updateListenHint();
      releaseWakeLock();
      msSetState(false);
      updateModeButtons();
    } else {
      // 一键朗读进行中：点每日听学按钮只停止一键朗读，不再误启动每日循环
      if (readAllPlaying) { stopReadAll(false); updateModeButtons(); return; }
      if (!HAS_AUDIO && !("speechSynthesis" in window)) { alert("当前环境无法播放语音"); return; }
      listenList = buildListenList();
      if (!listenList.length) { alert("该范围还没有词，先去学习一些吧"); return; }
      // 断点续读：存在未完成进度且范围一致则从上次位置继续
      var ls = state.listen || {};
      if (ls.done !== true && typeof ls.idx === "number" && ls.idx > 0
          && ls.idx < listenList.length && ls.range === (state.settings.range || "all")) {
        listenIdx = ls.idx;
      } else {
        listenIdx = 0;
      }
      listenPlaying = true;
      updateBigPlayButton();
      if (state.settings.keepAwake) requestWakeLock();
      msSetState(true);
      updateModeButtons();
      listenTick();
    }
  }

  // ---------- 一键朗读（单词→中文→例句，连播 N 遍，断点续读） ----------
  var readAllPlaying = false, readAllList = [], readAllIdx = 0, readAllRound = 1, readAllRounds = 3, readAllTimer = null;
  function readAllSave() {
    state.readAll = { idx: readAllIdx, round: readAllRound, rounds: readAllRounds, done: !readAllPlaying };
    save();
  }
  function buildReadAllList() {
    var s = state.settings;
    var mode = s.readallMode || "all";
    var list;
    if (mode && mode.indexOf("wl:") === 0) {
      list = getWordsByMode(mode).slice();
    } else if (mode === "letter") {
      var L = (s.readallLetter || "A").toUpperCase();
      list = WORDS.filter(function (w) { return w.w.charAt(0).toUpperCase() === L; });
    } else if (mode === "personal") {
      var ps = {};
      (state.personal || []).forEach(function (w) { ps[w] = true; });
      list = WORDS.filter(function (w) { return ps[w.w]; });   // 注意：w 是对象，要用 w.w 作键
    } else if (mode === "ab") {
      var a = Math.max(1, Math.min(WORDS.length, parseInt(s.ab.a, 10) || 1));
      var b = Math.max(a, Math.min(WORDS.length, parseInt(s.ab.b, 10) || WORDS.length));
      list = WORDS.slice(a - 1, b);
    } else {
      list = WORDS.slice();
    }
    return list;
  }
  function toggleExZh() {
    state.settings.showExZh = !state.settings.showExZh;
    save();
    var btn = el("ex-zh-toggle");
    btn.classList.toggle("on", state.settings.showExZh);
    btn.textContent = state.settings.showExZh ? "隐藏例句中文" : "显示例句中文";
    var zhEl = el("lc-ex-zh");
    zhEl.classList.toggle("show", state.settings.showExZh && !!zhEl.textContent);
  }
  function updateReadAllHint() {
    var ra = state.readAll || {}, h = el("readall-hint");
    var len = (readAllList && readAllList.length) || WORDS.length;
    if (ra.done === true || typeof ra.idx !== "number" || ra.idx >= len) { h.textContent = ""; return; }
    h.textContent = "断点：第 " + (ra.round || 1) + " 遍 · 第 " + (ra.idx + 1) + " 词";
  }
  function updateListenHint() {
    var ls = state.listen || {}, h = el("listen-hint");
    if (!h) return;
    var len = (listenList && listenList.length) || WORDS.length;
    if (ls.done === true || typeof ls.idx !== "number" || ls.idx >= len || ls.idx <= 0) { h.textContent = ""; return; }
    h.textContent = "断点续读：第 " + (ls.idx + 1) + " / " + len + " 词（上次暂停位置）";
  }
  function startReadAll() {
    if (readAllPlaying) { stopReadAll(false); return; }
    if (listenPlaying) toggleListen();
    if (!HAS_AUDIO && !("speechSynthesis" in window)) { alert("当前环境无法播放语音"); return; }
    readAllList = buildReadAllList();     // 全部 / 首字母 / 序号区间 / 个人库
    if (!readAllList.length) {
      alert("当前范围没有单词（个人单词库可能为空）。朗读时在显示区点「☆ 加入个人库」即可收集。");
      return;
    }
    var _rv = parseInt(el("readall-rounds").value, 10);
    readAllRounds = (_rv === 0) ? 0 : (_rv || 3);   // 0 = 一直循环
    // 断点续读：存在未完成进度则从上次位置继续
    var ra = state.readAll || {};
    if (ra.done !== true && typeof ra.idx === "number" && ra.idx < readAllList.length) {
      readAllIdx = ra.idx; readAllRound = ra.round || 1;
      if (ra.rounds) readAllRounds = ra.rounds;
    } else { readAllIdx = 0; readAllRound = 1; }
    readAllPlaying = true;
    el("readall-play").textContent = "⏸ 停止";
    updateReadAllHint();
    if (state.settings.keepAwake) requestWakeLock();
    msSetState(true);
    updateModeButtons();
    readAllStep();
  }
  // 对一个单词循环朗读「单词→词性→中文→例句」reps 遍，每遍之间留 350ms，最后回调
  function playSeqReps(item, reps, doneCb) {
    reps = Math.max(1, parseInt(reps, 10) || 1);
    var n = 0;
    function once(cb) {
      setStage("🔊 单词");
      sayEnWord(item, function () {
        sayPosZh(item, function () {
          setStage("🔊 中文");
          sayZh(item, function () {
            setStage("🔊 例句");
            sayExample(item, function () { setStage(""); cb(); });
          });
        });
      });
    }
    function loop() {
      n++;
      setStage("🔊 单词（第 " + n + "/" + reps + " 遍）");
      once(function () {
        if (n < reps) setTimeout(loop, 350);
        else doneCb();
      });
    }
    loop();
  }
  // 只朗读某词一次（供「上一个/下一个」手动跳转用）：单词→词性→中文→例句
  function playSingleWord(item) {
    setListenDisplay(item);
    setStage("🔊 单词");
    sayEnWord(item, function () {
      sayPosZh(item, function () {
        setStage("🔊 中文");
        sayZh(item, function () {
          setStage("🔊 例句");
          sayExample(item, function () { setStage(""); });
        });
      });
    });
  }
  function readAllStep() {
    if (!readAllPlaying) return;
    if (!readAllList.length) { stopReadAll(false); return; }
    if (readAllIdx >= readAllList.length) {
      readAllRound++;
      if (readAllRounds !== 0 && readAllRound > readAllRounds) { stopReadAll(true); return; }
      readAllIdx = 0; readAllSave();
    }
    var item = readAllList[readAllIdx];
    setListenDisplay(item);
    el("listen-status").textContent = "第 " + readAllRound + "/" + (readAllRounds || "∞") + " 遍 · 第 " + (readAllIdx + 1) + "/" + readAllList.length;
    // 对一个单词循环「单词→词性→中文→例句」N 遍，再朗读下一个单词（N=每词朗读次数）
    var reps = parseInt(state.settings.readallReps, 10) || 3;
    playSeqReps(item, reps, function () {
      readAllIdx++;
      readAllSave();                 // 每词后保存断点，关掉网页也能续读
      // 使用用户设置的单词间隔（秒），默认 3 秒
      var gapMs = (parseInt(state.settings.gap, 10) || 3) * 1000;
      readAllTimer = setTimeout(function () { readAllTimer = null; readAllStep(); }, gapMs);
    });
  }
  function stopReadAll(finished) {
    readAllPlaying = false;
    if (readAllTimer) { clearTimeout(readAllTimer); readAllTimer = null; }
    stopAudio();   // 立即掐断当前正在播放的音频
    el("readall-play").textContent = "▶ 一键朗读";
    el("listen-status").textContent = finished ? ("已朗读完 " + (readAllRounds || "∞") + " 遍 🎉") : "已暂停";
    setStage("");
    releaseWakeLock();
    msSetState(false);
    readAllSave();
    updateReadAllHint();
    updateModeButtons();
    updateNavInfo();
  }
  function restartReadAll() {
    stopReadAll(false);
    var _rrv = parseInt(el("readall-rounds").value, 10);
    state.readAll = { idx: 0, round: 1, rounds: (_rrv === 0) ? 0 : (_rrv || 3), done: true };
    save();
    updateReadAllHint();
    el("listen-status").textContent = "已重置，点击上方按钮从头开始";
  }

  // ---------- 上一个 / 下一个 单词导航 ----------
  function curNav() {
    // 正在播放的模式优先；否则用上次构建的列表
    if (readAllPlaying) return { list: readAllList, idx: readAllIdx, isRA: true };
    if (listenPlaying) return { list: listenList, idx: listenIdx, isRA: false };
    if (readAllList && readAllList.length) return { list: readAllList, idx: readAllIdx, isRA: true };
    if (listenList && listenList.length) return { list: listenList, idx: listenIdx, isRA: false };
    return { list: readAllList, idx: readAllIdx, isRA: true };
  }
  function updateNavInfo() {
    var info = el("nav-info"); if (!info) return;
    var c = curNav();
    if (!c.list || !c.list.length) { info.textContent = ""; return; }
    info.textContent = "第 " + (c.idx + 1) + " / " + c.list.length + " 词";
  }
  // delta = -1 上一个；+1 下一个。点击即跳到该词并重新朗读一遍（单词→词性→中文→例句）
  function navGoto(delta) {
    var c = curNav();
    if (!c.list || !c.list.length) return;
    var t = c.idx + delta;
    if (t < 0) t = 0;
    if (t >= c.list.length) t = c.list.length - 1;
    // 中断当前可能的播放与待执行定时器
    if (readAllTimer) { clearTimeout(readAllTimer); readAllTimer = null; }
    if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
    stopAudio();
    if (c.isRA) {
      readAllIdx = t;
      readAllSave();
      if (readAllPlaying) readAllStep();
      else playSingleWord(readAllList[t]);
    } else {
      listenIdx = t;
      if (listenPlaying) { setListenDisplay(listenList[t]); listenTick(); }
      else playSingleWord(listenList[t]);
    }
    updateNavInfo();
  }

  // ---------- 个人单词库 ----------
  function inPersonal(w) { return (state.personal || []).indexOf(w) >= 0; }
  function togglePersonalWord(wstr) {
    var arr = state.personal || [];
    var i = arr.indexOf(wstr);
    if (i >= 0) arr.splice(i, 1); else arr.push(wstr);
    state.personal = arr; save();
    renderWords();
    refreshPersonalBtn();
  }
  function refreshPersonalBtn() {
    var btn = el("personal-btn"); if (!btn) return;
    var cnt = el("personal-count");
    if (cnt) cnt.textContent = "个人库 " + (state.personal || []).length + " 词";
    if (currentItem && inPersonal(currentItem.w)) {
      btn.classList.add("on"); btn.textContent = "★ 已在个人库（点移除）";
    } else {
      btn.classList.remove("on"); btn.textContent = "☆ 加入个人库";
    }
  }
  function togglePersonal() {
    if (!currentItem) return;
    var arr = state.personal || [];
    var i = arr.indexOf(currentItem.w);
    if (i >= 0) arr.splice(i, 1); else arr.push(currentItem.w);
    state.personal = arr; save();
    refreshPersonalBtn();
    var pim = el("personal-inmode"); if (pim) pim.textContent = arr.length;
  }
  // 根据朗读范围模式显示/隐藏对应筛选框
  function syncReadallMode() {
    var m = state.settings.readallMode || "all";
    var lb = el("readall-letter-box"), ab = el("readall-ab-box"), pb = el("readall-personal-box");
    if (lb) lb.style.display = (m === "letter") ? "block" : "none";
    if (ab) ab.style.display = (m === "ab") ? "block" : "none";
    if (pb) pb.style.display = (m === "personal") ? "block" : "none";
    var pim = el("personal-inmode"); if (pim) pim.textContent = (state.personal || []).length;
  }

  // ---------- 词性学习栏目 ----------
  var POS_LESSONS = [
    { code: "v",    name: "动词",   sym: "v.",   intro: "表示动作或状态，比如 run（跑）、eat（吃）、be（是）、have（有）。句子里通常少不了它，主语做的“事”就靠它。", ex: "He runs every morning.", tip: "口诀：动词是说“做什么”，跑跳吃睡都是它。" },
    { code: "n",    name: "名词",   sym: "n.",   intro: "表示人、事物、地方或概念，比如 book（书）、water（水）、teacher（老师）、love（爱）。句子里最常见的“东西”就是名词。", ex: "The book is on the table.", tip: "口诀：名词就是“是什么”，人物地方加事物。" },
    { code: "adj",  name: "形容词", sym: "adj.", intro: "用来描述名词，说明它“是什么样的”，比如 big（大的）、red（红的）、good（好的）。常放在名词前面。", ex: "She has a big red bag.", tip: "口诀：形容词讲“什么样”，大小红绿它来状。" },
    { code: "adv",  name: "副词",   sym: "adv.", intro: "修饰动词、形容词或其他副词，常表示“怎么、多快、哪里”。很多以 -ly 结尾，比如 quickly（快速地）、very（非常）。", ex: "He speaks very quickly.", tip: "口诀：副词多带 ly 尾，快慢好坏它来陪。" },
    { code: "aux",  name: "助动词", sym: "aux.", intro: "帮助主要动词表达时态、疑问或否定，自己不单独表意，比如 can（能）、will（将）、do（做）。", ex: "She can swim very well.", tip: "口诀：助动词是“好帮手”，can will do 来凑。" },
    { code: "conj", name: "连词",   sym: "conj.",intro: "用来连接词、短语或句子，比如 and（和）、but（但是）、because（因为）。把句子串起来就靠它。", ex: "I like tea but he likes coffee.", tip: "口诀：连词就像“胶水’，and but 连成句。" },
    { code: "det",  name: "限定词", sym: "det.", intro: "放在名词前面，说明“哪一个 / 多少”，比如 the（这/那）、a（一个）、my（我的）、this（这个）。", ex: "This is my book.", tip: "口诀：限定词在名前站，a the my 定范围。" },
    { code: "prep", name: "介词",   sym: "prep.",intro: "表示名词和其他词之间的关系，常说明位置、时间、方向，比如 in（在…里）、on（在…上）、to（到）、with（和…一起）。", ex: "The cat is on the chair.", tip: "口诀：介词说“在哪儿”，in on to with 方位连。" },
    { code: "pron", name: "代词",   sym: "pron.",intro: "用来代替名词，避免重复，比如 I（我）、he（他）、it（它）、they（他们）。", ex: "He gave it to them.", tip: "口诀：代词替名词跑，I he it they 省啰嗦。" }
  ];
  function renderPos() {
    var html = "";
    POS_LESSONS.forEach(function (l) {
      html +=
        '<div class="pos-card" id="pos-card-' + l.code + '">' +
          '<div class="pos-head"><span class="pos-name">' + l.name + '</span><span class="lc-pos">' + l.sym + '</span></div>' +
          '<div class="pos-intro">' + esc(l.intro) + '</div>' +
          '<div class="pos-ex">📘 ' + esc(l.ex) + '</div>' +
          '<div class="pos-tip">💡 ' + esc(l.tip) + '</div>' +
          '<button class="pos-play" data-code="' + l.code + '">🔊 朗读（讲解+口诀）</button>' +
        '</div>';
    });
    el("pos-list").innerHTML = html;
    var btns = el("pos-list").querySelectorAll(".pos-play");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        var code = this.dataset.code;
        var l = null;
        for (var k = 0; k < POS_LESSONS.length; k++) if (POS_LESSONS[k].code === code) l = POS_LESSONS[k];
        if (l) playPos(l, this);
      });
    }
  }
  function playPos(l, btn) {
    if (!HAS_AUDIO && !("speechSynthesis" in window)) { alert("当前环境无法播放语音"); return; }
    var cards = el("pos-list").querySelectorAll(".pos-card");
    for (var i = 0; i < cards.length; i++) cards[i].classList.remove("playing");
    var card = el("pos-card-" + l.code); if (card) card.classList.add("playing");
    if (state.settings.keepAwake) requestWakeLock();
    el("pos-status").textContent = "正在朗读：" + l.name + " " + l.sym;
    function done() {
      el("pos-status").textContent = "已朗读完：" + l.name + "（可点其它词性继续）";
      if (card) card.classList.remove("playing");
      releaseWakeLock();
    }
    // 顺序：词性名(离线) → 讲解(离线) → 例句(离线) → 口诀(TTS)
    playMp3("audio/pos_" + l.code + ".mp3", function () {
      playMp3("audio/pos_intro_" + l.code + ".mp3", function () {
        playMp3("audio/pos_ex_" + l.code + ".mp3", function () {
          speakZh(l.tip.replace(/^口诀：/, "记忆口诀："), done);
        });
      });
    });
  }

  // ---------- 语法学习栏目 ----------
  var GRAMMAR_LESSONS = [
    { name: "一般现在时", intro: "说平时经常做的事、习惯或客观事实。比如“我每天吃苹果”“太阳从东边升起”。", formula: "主语 + 动词原形；第三人称单数(he/she/it)要加 -s / -es。", examples: ["I eat an apple every day. 我每天吃一个苹果。", "He eats an apple. 他吃一个苹果。"], tip: "口诀：经常事实用现在，三单动词要加 s。" },
    { name: "现在进行时", intro: "说此时此刻正在做的事。比如“我正在看书”“他们正在踢球”。", formula: "am / is / are + 动词 -ing（现在分词）。", examples: ["I am reading a book. 我正在看书。", "They are playing football. 他们正在踢球。"], tip: "口诀：现在进行 be 加 ing，动作正在发生中。" },
    { name: "一般过去时", intro: "说过去已经发生、做完了的事。比如“我昨天看了一部电影”。", formula: "主语 + 动词过去式（规则加 -ed；不规则要背，如 go→went）。", examples: ["I watched a film. 我看了一部电影。", "He went home. 他回家了。"], tip: "口诀：过去的事用过去，动词变成 ed 式。" },
    { name: "一般将来时", intro: "说打算或将要发生的事。比如“我明天要去北京”。", formula: "will + 动词原形；或 be going to + 动词原形（表示打算）。", examples: ["I will go to Beijing. 我要去北京。", "She is going to sing. 她打算唱歌。"], tip: "口诀：将来要做 will 加动，打算用 be going to。" },
    { name: "现在完成时", intro: "说一个过去发生、但和现在还有关联的动作，常翻译“已经…了”。比如“我已经吃过饭了”。", formula: "have / has + 动词过去分词（done 形式）。", examples: ["I have eaten lunch. 我已经吃过午饭了。", "She has finished homework. 她写完了作业。"], tip: "口诀：完成时态 have/has，过去分词跟后头。" },
    { name: "形容词比较级", intro: "把两样东西比一比，谁更…。比如“他比我高”“这部手机更便宜”。", formula: "短词加 -er（tall→taller）；多音节词用 more + 原级（more beautiful）。", examples: ["He is taller than me. 他比我高。", "This phone is cheaper. 这部手机更便宜。"], tip: "口诀：两者比较加 er，多音节词 more 放前。" },
    { name: "情态动词 can / must", intro: "表示“能、会、必须”等语气，后面永远跟动词原形。比如“我会游泳”“你必须睡觉”。", formula: "can / must / should + 动词原形（不三单加 s，也不加 to）。", examples: ["I can swim. 我会游泳。", "You must sleep. 你必须睡觉。"], tip: "口诀：情态动词很特别，后面永远跟原形。" },
    { name: "There be 句型", intro: "说“某处有某物/某人”，表示存在。比如“桌上有一本书”“公园里有许多花”。", formula: "There is + 单数/不可数；There are + 复数。就近原则：挨着 is/are 的词决定单复数。", examples: ["There is a book on the desk. 桌上有一本书。", "There are many flowers. 有许多花。"], tip: "口诀：there be 表存在，就近原则单数先。" }
  ];
  // 语法朗读序列号，用于停止/重启动断当前朗读链
  var grammarRunId = 0;
  function renderGrammar() {
    // ---- 思维导图（顶部总览，可点击跳转到对应语法点）----
    var cats = [
      { name: "时态", items: [0, 1, 2, 3, 4] },
      { name: "比较级", items: [5] },
      { name: "情态动词", items: [6] },
      { name: "There be", items: [7] }
    ];
    var svg = '<svg viewBox="0 0 760 440" width="100%" style="max-width:760px;display:block;margin:6px auto 12px" font-family="inherit" role="img" aria-label="语法思维导图">';
    svg += mindNode(70, 198, 110, 44, "语法总览", "#2f6fed", "#fff", "");
    var catX = 250, catW = 120, leafX = 490, leafW = 160, leafH = 40;
    var catY = [55, 252, 308, 364];
    var tY = [];
    for (var t = 0; t < 5; t++) tY.push(20 + t * 50);
    for (var c = 0; c < cats.length; c++) {
      var cy = catY[c];
      svg += mindLine(180, 220, catX, cy + 22);
      svg += mindNode(catX, cy, catW, 44, cats[c].name, "#e3edff", "#1f4fb0", "");
      var items = cats[c].items;
      for (var k = 0; k < items.length; k++) {
        var idx = items[k];
        var ly = (c === 0) ? tY[k] : cy + 2;
        svg += mindLine(catX + catW, cy + 22, leafX, ly + leafH / 2);
        svg += mindNode(leafX, ly, leafW, leafH, GRAMMAR_LESSONS[idx].name, "#fff", "#333", 'data-g="' + idx + '"');
      }
    }
    svg += '</svg>';
    el("grammar-mindmap").innerHTML = svg;
    el("grammar-mindmap").addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-g]") : null;
      if (!t) return;
      openGrammar(parseInt(t.getAttribute("data-g"), 10));
    });

    // ---- 语法点卡片列表 ----
    var html = "";
    GRAMMAR_LESSONS.forEach(function (g, idx) {
      var exHtml = "";
      g.examples.forEach(function (e) { exHtml += '<div class="g-ex">📗 ' + esc(e) + '</div>'; });
      html +=
        '<div class="g-card" id="g-card-' + idx + '">' +
          '<div class="g-head"><span class="g-name">' + esc(g.name) + '</span></div>' +
          '<div class="g-intro">' + esc(g.intro) + '</div>' +
          '<div class="g-formula">📐 结构：' + esc(g.formula) + '</div>' +
          exHtml +
          '<div class="pos-tip">💡 ' + esc(g.tip) + '</div>' +
          '<button class="pos-play g-play" data-g="' + idx + '">🔊 朗读讲解</button>' +
        '</div>';
    });
    el("grammar-list").innerHTML = html;
    var btns = el("grammar-list").querySelectorAll(".g-play");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        var g = GRAMMAR_LESSONS[parseInt(this.dataset.g, 10)];
        if (g) playGrammar(g, this);
      });
    }
  }
  // 思维导图节点（attrs 为附加属性串，如 data-g="0" / data-cat="vowel" data-sub="mono"；空串=不可点击）
  function mindNode(x, y, w, h, label, fill, color, attrs) {
    var clickable = !!(attrs && attrs.length);
    var r = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="11" ry="11" fill="' + fill + '" stroke="' + (clickable ? "#2f6fed" : "#bcd2ff") + '" stroke-width="' + (clickable ? 2 : 1) + '"' + (attrs ? " " + attrs : "") + (clickable ? ' style="cursor:pointer"' : '') + '>';
    r += '<title>' + esc(label) + '</title></rect>';
    r += '<text x="' + (x + w / 2) + '" y="' + (y + h / 2) + '" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="600" fill="' + color + '" pointer-events="none">' + esc(label) + '</text>';
    return r;
  }
  function mindLine(x1, y1, x2, y2) {
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#c9d8f5" stroke-width="2" />';
  }
  function openGrammar(idx) {
    var card = el("g-card-" + idx);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("flash");
    void card.offsetWidth; // 重启动画
    card.classList.add("flash");
    setTimeout(function () { card.classList.remove("flash"); }, 2000);
  }
  // 将一条语法讲解拆成 {text, lang} 朗读队列：名称→讲解→结构→例句(英+中)
  function grammarQueue(g) {
    var q = [];
    q.push({ text: g.name + "。", lang: "zh-CN" });
    q.push({ text: g.intro, lang: "zh-CN" });
    q.push({ text: "结构：" + g.formula, lang: "zh-CN" });
    g.examples.forEach(function (e) {
      var sp = e.indexOf(". ");
      if (sp > 0) { q.push({ text: e.slice(0, sp), lang: "en-US" }); q.push({ text: e.slice(sp + 2), lang: "zh-CN" }); }
      else { q.push({ text: e, lang: "en-US" }); }
    });
    return q;
  }
  function playGrammar(g, btn) {
    if (!HAS_AUDIO && !("speechSynthesis" in window)) { alert("当前环境无法播放语音"); return; }
    grammarRunId++;                 // 使旧朗读链失效
    var myRun = grammarRunId;
    stopAudio();
    var idx = GRAMMAR_LESSONS.indexOf(g);
    var cards = el("grammar-list").querySelectorAll(".g-card");
    for (var i = 0; i < cards.length; i++) cards[i].classList.remove("playing");
    var card = el("g-card-" + idx); if (card) card.classList.add("playing");
    if (state.settings.keepAwake) requestWakeLock();
    var queue = grammarQueue(g);
    var i2 = 0;
    function alive() { return myRun === grammarRunId; }
    function next() {
      if (!alive()) return;
      if (i2 >= queue.length) { finish(); return; }
      var it = queue[i2++];
      el("grammar-status").textContent = "正在朗读：" + g.name + "（" + i2 + "/" + queue.length + "）";
      speak(it.text, it.lang, function () { if (alive()) next(); });
    }
    function finish() {
      if (!alive()) return;
      el("grammar-status").textContent = "已朗读完：" + g.name + "（可点其它语法点继续）";
      if (card) card.classList.remove("playing");
      releaseWakeLock();
    }
    next();
  }
  // 一键朗读全部语法点
  function playAllGrammar() {
    if (!HAS_AUDIO && !("speechSynthesis" in window)) { alert("当前环境无法播放语音"); return; }
    grammarRunId++;
    var myRun = grammarRunId;
    stopAudio();
    if (state.settings.keepAwake) requestWakeLock();
    var i = 0;
    function alive() { return myRun === grammarRunId; }
    function nextOne() {
      if (!alive()) return;
      if (i >= GRAMMAR_LESSONS.length) { finish(); return; }
      var g = GRAMMAR_LESSONS[i];
      var cards = el("grammar-list").querySelectorAll(".g-card");
      for (var c = 0; c < cards.length; c++) cards[c].classList.remove("playing");
      var card = el("g-card-" + i);
      if (card) { card.classList.add("playing"); card.scrollIntoView({ behavior: "smooth", block: "center" }); }
      el("grammar-status").textContent = "正在朗读语法 (" + (i + 1) + "/" + GRAMMAR_LESSONS.length + ")：" + g.name;
      var queue = grammarQueue(g);
      var j = 0;
      function nextItem() {
        if (!alive()) return;
        if (j >= queue.length) { i++; nextOne(); return; }
        var it = queue[j++];
        speak(it.text, it.lang, function () { if (alive()) nextItem(); });
      }
      nextItem();
    }
    function finish() {
      if (!alive()) return;
      el("grammar-status").textContent = "已全部朗读完 " + GRAMMAR_LESSONS.length + " 个语法点 ✅（可再点一次重听）";
      var cards = el("grammar-list").querySelectorAll(".g-card");
      for (var c = 0; c < cards.length; c++) cards[c].classList.remove("playing");
      releaseWakeLock();
    }
    nextOne();
  }

  // ---------- 音标学习栏目 ----------
  // 口型 SVG：round 圆唇程度(0-1)，open 张口程度(0-1)，tongue 是否露舌尖
  function mouthSvg(round, open, tongue) {
    round = round || 0; open = open || 0;
    var W = 120, H = 90, cx = 60, cy = 47;
    var rx = 34 - round * 12;
    var ryO = 11 + open * 30;
    var lipFill = "#E8A6BC", lipStroke = "#C65B7C";
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">';
    s += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (rx + 11) + '" ry="' + (ryO + 15) + '" fill="#FBE9EF" stroke="#F0CBD9" stroke-width="1.5"/>';
    s += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ryO + '" fill="' + lipFill + '" stroke="' + lipStroke + '" stroke-width="2.5"/>';
    if (open > 0.08) {
      var crx = rx * 0.6, cry = ryO * 0.62;
      s += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + crx + '" ry="' + cry + '" fill="#6E2B3C"/>';
      if (tongue && open > 0.22) {
        s += '<path d="M ' + (cx - crx * 0.7) + ' ' + (cy + cry * 0.1) +
             ' Q ' + cx + ' ' + (cy + cry * 1.05) + ' ' + (cx + crx * 0.7) + ' ' + (cy + cry * 0.1) +
             ' Q ' + cx + ' ' + (cy + cry * 0.5) + ' ' + (cx - crx * 0.7) + ' ' + (cy + cry * 0.1) + ' Z" fill="#E8749A"/>';
      }
    }
    s += '</svg>';
    return s;
  }
  var PHONICS = [
    // 单元音 12
    { s: "iː", g: "单元音", m: "嘴角向两边咧开，舌尖抵下齿，嘴微张。", ex: [["see", "siː", "看见"], ["tea", "tiː", "茶"]], r: 0.05, o: 0.22 },
    { s: "ɪ", g: "单元音", m: "嘴比 iː 放松一点，舌尖抵下齿，短促。", ex: [["sit", "sɪt", "坐"], ["big", "bɪg", "大的"]], r: 0.1, o: 0.3 },
    { s: "e", g: "单元音", m: "嘴半开，舌尖抵下齿，像微笑。", ex: [["bed", "bed", "床"], ["pen", "pen", "钢笔"]], r: 0.15, o: 0.45 },
    { s: "æ", g: "单元音", m: "嘴张大，舌尖抵下齿，苹果音。", ex: [["cat", "kæt", "猫"], ["map", "mæp", "地图"]], r: 0.1, o: 0.72 },
    { s: "ɜː", g: "单元音", m: "嘴半开，舌身平放居中，长音。", ex: [["bird", "bɜːd", "鸟"], ["girl", "gɜːl", "女孩"]], r: 0.3, o: 0.42 },
    { s: "ə", g: "单元音", m: "最轻松的弱读音，嘴微张居中。", ex: [["about", "əˈbaʊt", "关于"], ["China", "ˈtʃaɪnə", "中国"]], r: 0.3, o: 0.35 },
    { s: "ɔː", g: "单元音", m: "双唇收圆向前突，嘴半开，长音。", ex: [["door", "dɔː", "门"], ["four", "fɔː", "四"]], r: 0.85, o: 0.45 },
    { s: "ɒ", g: "单元音", m: "嘴张大，双唇略圆，短促。", ex: [["dog", "dɒg", "狗"], ["hot", "hɒt", "热的"]], r: 0.7, o: 0.55 },
    { s: "uː", g: "单元音", m: "双唇收圆向前突，嘴近闭，长音。", ex: [["food", "fuːd", "食物"], ["two", "tuː", "二"]], r: 0.95, o: 0.2 },
    { s: "ʊ", g: "单元音", m: "双唇略圆，嘴半闭，短促。", ex: [["book", "bʊk", "书"], ["good", "gʊd", "好的"]], r: 0.8, o: 0.3 },
    { s: "ɑː", g: "单元音", m: "嘴张大，舌身放低向后，长音。", ex: [["car", "kɑː", "汽车"], ["star", "stɑː", "星星"]], r: 0.15, o: 0.68 },
    { s: "ʌ", g: "单元音", m: "嘴半开，舌身居中偏后，短促。", ex: [["cup", "kʌp", "杯子"], ["sun", "sʌn", "太阳"]], r: 0.2, o: 0.45 },
    // 双元音 8
    { s: "eɪ", g: "双元音", m: "从 e 滑向 ɪ，嘴角由开到咧。", ex: [["cake", "keɪk", "蛋糕"], ["day", "deɪ", "天"]], r: 0.1, o: 0.42 },
    { s: "aɪ", g: "双元音", m: "从 ɑ 滑向 ɪ，嘴由大到小。", ex: [["time", "taɪm", "时间"], ["bike", "baɪk", "自行车"]], r: 0.05, o: 0.7 },
    { s: "ɔɪ", g: "双元音", m: "从 ɔ 圆唇滑向 ɪ。", ex: [["boy", "bɔɪ", "男孩"], ["oil", "ɔɪl", "油"]], r: 0.6, o: 0.5 },
    { s: "aʊ", g: "双元音", m: "从 ɑ 滑向 ʊ，嘴由大收圆。", ex: [["house", "haʊs", "房子"], ["now", "naʊ", "现在"]], r: 0.5, o: 0.6 },
    { s: "əʊ", g: "双元音", m: "从 ə 滑向 ʊ，双唇渐圆。", ex: [["go", "gəʊ", "去"], ["no", "nəʊ", "不"]], r: 0.7, o: 0.4 },
    { s: "ɪə", g: "双元音", m: "从 ɪ 滑向 ə，由咧到放松。", ex: [["ear", "ɪə", "耳朵"], ["here", "hɪə", "这里"]], r: 0.2, o: 0.45 },
    { s: "eə", g: "双元音", m: "从 e 滑向 ə，嘴由开到松。", ex: [["air", "eə", "空气"], ["hair", "heə", "头发"]], r: 0.15, o: 0.55 },
    { s: "ʊə", g: "双元音", m: "从 ʊ 圆唇滑向 ə。", ex: [["sure", "ʃʊə", "确信"], ["tour", "tʊə", "旅行"]], r: 0.6, o: 0.45 },
    // 辅音 24
    { s: "p", g: "辅音", m: "双唇紧闭再突然张开，送气不发声。", ex: [["pen", "pen", "钢笔"], ["cup", "kʌp", "杯子"]], r: 0, o: 0, tongue: false },
    { s: "b", g: "辅音", m: "双唇紧闭再张开，声带振动。", ex: [["big", "bɪg", "大的"], ["book", "bʊk", "书"]], r: 0, o: 0, tongue: false },
    { s: "t", g: "辅音", m: "舌尖抵上齿龈，弹开送气。", ex: [["tea", "tiː", "茶"], ["cat", "kæt", "猫"]], r: 0.1, o: 0.15, tongue: true },
    { s: "d", g: "辅音", m: "舌尖抵上齿龈，弹开声带振动。", ex: [["dog", "dɒg", "狗"], ["red", "red", "红色"]], r: 0.1, o: 0.15, tongue: true },
    { s: "k", g: "辅音", m: "舌根抵软腭，弹开送气。", ex: [["cat", "kæt", "猫"], ["book", "bʊk", "书"]], r: 0.1, o: 0.2, tongue: false },
    { s: "g", g: "辅音", m: "舌根抵软腭，弹开声带振动。", ex: [["go", "gəʊ", "去"], ["dog", "dɒg", "狗"]], r: 0.1, o: 0.2, tongue: false },
    { s: "f", g: "辅音", m: "上齿轻咬下唇，送气摩擦。", ex: [["fish", "fɪʃ", "鱼"], ["coffee", "ˈkɒfi", "咖啡"]], r: 0.2, o: 0.2, tongue: false },
    { s: "v", g: "辅音", m: "上齿轻咬下唇，声带振动。", ex: [["very", "ˈveri", "非常"], ["love", "lʌv", "爱"]], r: 0.2, o: 0.2, tongue: false },
    { s: "θ", g: "辅音", m: "舌尖伸到上下齿之间，送气。", ex: [["think", "θɪŋk", "想"], ["three", "θriː", "三"]], r: 0.1, o: 0.28, tongue: true },
    { s: "ð", g: "辅音", m: "舌尖伸到上下齿之间，声带振动。", ex: [["this", "ðɪs", "这个"], ["that", "ðæt", "那个"]], r: 0.1, o: 0.28, tongue: true },
    { s: "s", g: "辅音", m: "舌尖近上齿龈，气流摩擦。", ex: [["see", "siː", "看见"], ["bus", "bʌs", "公交车"]], r: 0.2, o: 0.2, tongue: false },
    { s: "z", g: "辅音", m: "舌尖近上齿龈，气流摩擦声带振动。", ex: [["zoo", "zuː", "动物园"], ["busy", "ˈbɪzi", "忙碌的"]], r: 0.2, o: 0.2, tongue: false },
    { s: "ʃ", g: "辅音", m: "双唇略圆突出，舌身抬起摩擦。", ex: [["she", "ʃiː", "她"], ["fish", "fɪʃ", "鱼"]], r: 0.45, o: 0.2, tongue: false },
    { s: "ʒ", g: "辅音", m: "双唇略圆突出，舌身抬起摩擦声带振动。", ex: [["vision", "ˈvɪʒn", "视力"], ["measure", "ˈmeʒə", "测量"]], r: 0.45, o: 0.2, tongue: false },
    { s: "h", g: "辅音", m: "口微张，气流从喉咙轻轻呼出。", ex: [["he", "hiː", "他"], ["hello", "həˈləʊ", "你好"]], r: 0.25, o: 0.3, tongue: false },
    { s: "tʃ", g: "辅音", m: "舌尖抵齿龈，像“吃”的起始。", ex: [["chair", "tʃeə", "椅子"], ["watch", "wɒtʃ", "手表"]], r: 0.35, o: 0.2, tongue: true },
    { s: "dʒ", g: "辅音", m: "舌尖抵齿龈，像“知”的起始，声带振动。", ex: [["jump", "dʒʌmp", "跳"], ["orange", "ˈɒrɪndʒ", "橘子"]], r: 0.35, o: 0.2, tongue: true },
    { s: "m", g: "辅音", m: "双唇紧闭，鼻音振动。", ex: [["man", "mæn", "男人"], ["milk", "mɪlk", "牛奶"]], r: 0, o: 0, tongue: false },
    { s: "n", g: "辅音", m: "舌尖抵上齿龈，鼻音振动。", ex: [["no", "nəʊ", "不"], ["pen", "pen", "钢笔"]], r: 0.1, o: 0.15, tongue: true },
    { s: "ŋ", g: "辅音", m: "舌根抵软腭，鼻音振动。", ex: [["sing", "sɪŋ", "唱歌"], ["king", "kɪŋ", "国王"]], r: 0.1, o: 0.2, tongue: false },
    { s: "l", g: "辅音", m: "舌尖抵上齿龈，气流从舌边出。", ex: [["like", "laɪk", "喜欢"], ["ball", "bɔːl", "球"]], r: 0.1, o: 0.15, tongue: true },
    { s: "r", g: "辅音", m: "双唇收圆，舌尖卷起不接触。", ex: [["red", "red", "红色"], ["run", "rʌn", "跑"]], r: 0.8, o: 0.2, tongue: true },
    { s: "w", g: "辅音", m: "双唇收圆突出，像“乌”的起始。", ex: [["we", "wiː", "我们"], ["water", "ˈwɔːtə", "水"]], r: 0.95, o: 0.15, tongue: false },
    { s: "j", g: "辅音", m: "嘴角向两边咧，像“衣”的起始。", ex: [["yes", "jes", "是"], ["you", "juː", "你"]], r: 0.05, o: 0.2, tongue: false }
  ];
  function renderPhonics() {
    function isVowel(p) { return p.g === "单元音" || p.g === "双元音"; }
    var vowel = PHONICS.filter(isVowel);
    var cons = PHONICS.filter(function (p) { return !isVowel(p); });
    var mono = vowel.filter(function (p) { return p.g === "单元音"; });
    var diph = vowel.filter(function (p) { return p.g === "双元音"; });

    function card(p) {
      var idx = PHONICS.indexOf(p);
      var exHtml = "";
      p.ex.forEach(function (e) {
        exHtml += '<span class="ph-ex" data-word="' + esc(e[0]) + '">🔊 ' + esc(e[0]) + ' <i>/' + esc(e[1]) + '/</i> ' + esc(e[2]) + '</span>';
      });
      return '<div class="ph-card" id="ph-card-' + idx + '">' +
          '<div class="ph-body">' +
            '<div class="ph-sym">/' + esc(p.s) + '/</div>' +
            '<div class="ph-mouth-txt">👄 ' + esc(p.m) + '</div>' +
            '<div class="ph-btns">' +
              '<button class="pos-play ph-play ph-play-ph" data-ph-sym="' + esc(p.s) + '">🔊 听音标</button>' +
              '<button class="pos-play ph-play ph-play-ex" data-ph="' + idx + '">🔊 听示例词</button>' +
            '</div>' +
            '<div class="ph-exs">' + exHtml + '</div>' +
          '</div>' +
        '</div>';
    }
    function cardsHtml(arr) { return arr.map(card).join(""); }

    var html = "";
    // ===== 元音大类（默认展开）=====
    html +=
      '<div class="ph-cat ph-cat-open" data-cat="vowel">' +
        '<div class="ph-cat-head" data-toggle="cat" data-cat="vowel">' +
          '<span class="ph-cat-name">🔤 元音 Vowels</span>' +
          '<span class="ph-cat-sub">共 ' + vowel.length + ' 个 · 气流不受阻碍，声音响亮能拉长</span>' +
          '<span class="ph-arrow">▾</span>' +
        '</div>' +
        '<div class="ph-cat-body">' +
          // 单元音（默认展开）
          '<div class="ph-sub ph-sub-open" data-sub="mono">' +
            '<div class="ph-sub-head" data-toggle="sub" data-sub="mono">' +
              '<span>单元音 · 口型固定、舌头不动的单纯音（' + mono.length + ' 个）</span>' +
              '<span class="ph-arrow">▾</span>' +
            '</div>' +
            '<div class="ph-sub-body">' + cardsHtml(mono) + '</div>' +
          '</div>' +
          // 双元音（默认折叠，扩展提示）
          '<div class="ph-sub" data-sub="diph">' +
            '<div class="ph-sub-head" data-toggle="sub" data-sub="diph">' +
              '<span>双元音 · 由两个单元音快速滑动组合而成（' + diph.length + ' 个）→ 点开看扩展</span>' +
              '<span class="ph-arrow">▸</span>' +
            '</div>' +
            '<div class="ph-sub-body" style="display:none">' + cardsHtml(diph) +
              '<div class="ph-hint">💡 双元音 = 单元音① 滑动到 单元音②，如 /eɪ/ = /e/ → /ɪ/。先把上面的单元音练熟，这里就水到渠成。</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    // ===== 辅音大类（默认折叠）=====
    html +=
      '<div class="ph-cat" data-cat="cons">' +
        '<div class="ph-cat-head" data-toggle="cat" data-cat="cons">' +
          '<span class="ph-cat-name">🔠 辅音 Consonants</span>' +
          '<span class="ph-cat-sub">共 ' + cons.length + ' 个 · 气流受唇/舌/齿阻碍，大多不响亮</span>' +
          '<span class="ph-arrow">▸</span>' +
        '</div>' +
        '<div class="ph-cat-body" style="display:none">' + cardsHtml(cons) +
          '<div class="ph-hint">💡 辅音是气流受阻碍发出的音。爆破音（p b t d k g）、摩擦音（f v s z 等）、鼻音（m n ŋ）各有诀窍，点示例词听辨。</div>' +
        '</div>' +
      '</div>';

    el("phonics-list").innerHTML = html;

    // ---- 思维导图总览（可点击展开/跳转对应分组）----
    var pv = PHONICS.filter(isVowel).length;
    var pm = PHONICS.filter(function (p) { return p.g === "单元音"; }).length;
    var pd = PHONICS.filter(function (p) { return p.g === "双元音"; }).length;
    var pc = PHONICS.length - pv;
    var psvg = '<svg viewBox="0 0 720 420" width="100%" style="max-width:720px;display:block;margin:6px auto 12px" font-family="inherit" role="img" aria-label="音标思维导图">';
    psvg += mindNode(70, 195, 110, 46, "英语音标", "#2f6fed", "#fff", "");
    psvg += mindLine(180, 218, 250, 92);
    psvg += mindNode(250, 70, 140, 46, "元音 Vowels（" + pv + "）", "#e3edff", "#1f4fb0", 'data-cat="vowel"');
    psvg += mindLine(390, 93, 470, 51);
    psvg += mindNode(470, 30, 190, 42, "单元音（" + pm + "）", "#fff", "#333", 'data-cat="vowel" data-sub="mono"');
    psvg += mindLine(390, 93, 470, 151);
    psvg += mindNode(470, 130, 190, 42, "双元音（" + pd + "）", "#fff", "#333", 'data-cat="vowel" data-sub="diph"');
    psvg += mindLine(180, 218, 250, 350);
    psvg += mindNode(250, 328, 140, 46, "辅音 Consonants（" + pc + "）", "#e3edff", "#1f4fb0", 'data-cat="cons"');
    psvg += mindLine(390, 351, 470, 349);
    psvg += mindNode(470, 328, 190, 42, "全部辅音（" + pc + "）", "#fff", "#333", 'data-cat="cons"');
    psvg += '</svg>';
    el("phonics-mindmap").innerHTML = psvg;
    el("phonics-mindmap").addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-cat]") : null;
      if (!t) return;
      openPhonicsGroup(t.getAttribute("data-cat"), t.getAttribute("data-sub"));
    });

    // 「听示例词」按钮
    var exBtns = el("phonics-list").querySelectorAll(".ph-play-ex");
    for (var i = 0; i < exBtns.length; i++) {
      exBtns[i].addEventListener("click", function () {
        var p = PHONICS[parseInt(this.dataset.ph, 10)];
        if (p) playPhonics(p);
      });
    }
    // 「听音标」按钮（朗读音标本身）
    var phBtns = el("phonics-list").querySelectorAll(".ph-play-ph");
    for (var pi = 0; pi < phBtns.length; pi++) {
      phBtns[pi].addEventListener("click", function () {
        playPhoneme(this.dataset.phSym);
      });
    }
    var exs = el("phonics-list").querySelectorAll(".ph-ex");
    for (var k = 0; k < exs.length; k++) {
      exs[k].addEventListener("click", function () {
        playPhonicsWord(this.dataset.word);
      });
    }
    // 大类 / 子分组 折叠展开
    var tog = el("phonics-list").querySelectorAll("[data-toggle]");
    for (var t = 0; t < tog.length; t++) {
      tog[t].addEventListener("click", function () {
        var kind = this.dataset.toggle;
        var box = this.parentNode;
        var body = box.querySelector(kind === "cat" ? ".ph-cat-body" : ".ph-sub-body");
        var arrow = this.querySelector(".ph-arrow");
        var openCls = kind === "cat" ? "ph-cat-open" : "ph-sub-open";
        var isOpen = box.classList.toggle(openCls);
        if (body) body.style.display = isOpen ? "" : "none";
        if (arrow) arrow.textContent = isOpen ? "▾" : "▸";
      });
    }
  }
  // 音标思维导图点击：展开对应大类/子分组并滚动高亮
  function openPhonicsGroup(cat, sub) {
    var box = el("phonics-list").querySelector('.ph-cat[data-cat="' + cat + '"]');
    if (box) {
      box.classList.add("ph-cat-open");
      var body = box.querySelector(".ph-cat-body"); if (body) body.style.display = "";
      var arrow = box.querySelector(".ph-arrow"); if (arrow) arrow.textContent = "▾";
      flashEl(box);
    }
    if (sub) {
      var sbox = el("phonics-list").querySelector('.ph-sub[data-sub="' + sub + '"]');
      if (sbox) {
        sbox.classList.add("ph-sub-open");
        var sbody = sbox.querySelector(".ph-sub-body"); if (sbody) sbody.style.display = "";
        var sarrow = sbox.querySelector(".ph-arrow"); if (sarrow) sarrow.textContent = "▾";
        flashEl(sbox);
      }
    }
    var target = sub ? el("phonics-list").querySelector('.ph-sub[data-sub="' + sub + '"]') : box;
    if (target) target.scrollIntoView({ behavior: "smooth", block: sub ? "center" : "start" });
  }
  function flashEl(node) {
    if (!node) return;
    node.classList.remove("flash");
    void node.offsetWidth; // 重启动画
    node.classList.add("flash");
    setTimeout(function () { node.classList.remove("flash"); }, 2000);
  }
  // 播放单个示例词：优先离线音频，否则回退浏览器 TTS
  function playPhonicsWord(word, cb) {
    var key = (word || "").toLowerCase();
    var url = (typeof PHONICS_AUDIO !== "undefined" && PHONICS_AUDIO[key]) ? PHONICS_AUDIO[key] : null;
    if (url) { playMp3(url, cb); }
    else { speakEn(word, cb); }
  }
  // 朗读音标本身：优先离线音标音频，否则回退浏览器 TTS
  function playPhoneme(sym, cb) {
    var key = sym || "";
    var url = (typeof PHONICS_PH_AUDIO !== "undefined" && PHONICS_PH_AUDIO[key]) ? PHONICS_PH_AUDIO[key] : null;
    if (url) { playMp3(url, cb); }
    else { speakEn(sym, cb); }
  }
  function playPhonics(p) {
    if (!HAS_AUDIO && !("speechSynthesis" in window)) { alert("当前环境无法播放语音"); return; }
    phonicsRunId++;
    var myRun = phonicsRunId;
    stopAudio();
    var idx = PHONICS.indexOf(p);
    var cards = el("phonics-list").querySelectorAll(".ph-card");
    for (var i = 0; i < cards.length; i++) cards[i].classList.remove("playing");
    var card = el("ph-card-" + idx); if (card) card.classList.add("playing");
    if (state.settings.keepAwake) requestWakeLock();
    el("phonics-status").textContent = "正在朗读：/" + p.s + "/ 的示例词 " + p.ex.map(function (e) { return e[0]; }).join("、");
    var i = 0;
    function alive() { return myRun === phonicsRunId; }
    function next() {
      if (!alive()) return;
      if (i >= p.ex.length) { finish(); return; }
      var word = p.ex[i][0]; i++;
      playPhonicsWord(word, function () { next(); });
    }
    function finish() {
      if (!alive()) return;
      el("phonics-status").textContent = "已朗读完：/" + p.s + "/（可点其它音标继续）";
      if (card) card.classList.remove("playing");
      releaseWakeLock();
    }
    next();
  }
  // 一键朗读全部音标（示例词串读）
  function playAllPhonics() {
    if (!HAS_AUDIO && !("speechSynthesis" in window)) { alert("当前环境无法播放语音"); return; }
    phonicsRunId++;
    var myRun = phonicsRunId;
    stopAudio();
    // 朗读前展开全部大类与子分组，便于跟读看到进度
    var cats = el("phonics-list").querySelectorAll(".ph-cat");
    for (var c = 0; c < cats.length; c++) {
      cats[c].classList.add("ph-cat-open");
      var b = cats[c].querySelector(".ph-cat-body"); if (b) b.style.display = "";
      var a = cats[c].querySelector(".ph-arrow"); if (a) a.textContent = "▾";
    }
    var subs = el("phonics-list").querySelectorAll(".ph-sub");
    for (var s = 0; s < subs.length; s++) {
      subs[s].classList.add("ph-sub-open");
      var sb = subs[s].querySelector(".ph-sub-body"); if (sb) sb.style.display = "";
      var sa = subs[s].querySelector(".ph-arrow"); if (sa) sa.textContent = "▾";
    }
    if (state.settings.keepAwake) requestWakeLock();
    var i = 0;
    function alive() { return myRun === phonicsRunId; }
    function nextPh() {
      if (!alive()) return;
      if (i >= PHONICS.length) { finish(); return; }
      var p = PHONICS[i];
      el("phonics-status").textContent = "正在朗读音标 (" + (i + 1) + "/" + PHONICS.length + ")：/" + p.s + "/  " + p.ex.map(function (e) { return e[0]; }).join("、");
      var cards = el("phonics-list").querySelectorAll(".ph-card");
      for (var c = 0; c < cards.length; c++) cards[c].classList.remove("playing");
      var card = el("ph-card-" + i); if (card) card.classList.add("playing");
      // 先读音标本身，再跟读示例词
      playPhoneme(p.s, function () {
        var j = 0;
        function nextWord() {
          if (!alive()) return;
          if (j >= p.ex.length) { i++; nextPh(); return; }
          var word = p.ex[j][0]; j++;
          playPhonicsWord(word, function () { nextWord(); });
        }
        nextWord();
      });
    }
    function finish() {
      if (!alive()) return;
      el("phonics-status").textContent = "已全部朗读完 " + PHONICS.length + " 个音标 ✅（可再点一次重听）";
      var cards = el("phonics-list").querySelectorAll(".ph-card");
      for (var c = 0; c < cards.length; c++) cards[c].classList.remove("playing");
      releaseWakeLock();
    }
    nextPh();
  }

  // ---------- 基础学习子标签切换 ----------
  function switchPosTab(name) {
    var tabs = document.querySelectorAll(".ps-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("on", tabs[i].getAttribute("data-pos") === name);
    el("pos-panel").style.display = (name === "pos") ? "" : "none";
    el("grammar-panel").style.display = (name === "grammar") ? "" : "none";
    el("phonics-panel").style.display = (name === "phonics") ? "" : "none";
  }

  // ---------- 统计 ----------
  function renderStats() {
    var total = WORDS.length, learned = 0, mastered = 0;
    var catTotal = {}, catLearned = {};
    CATS.forEach(function (c) { catTotal[c] = 0; catLearned[c] = 0; });
    WORDS.forEach(function (w) {
      catTotal[w.cat]++;
      if (state.learned[w.w]) { learned++; catLearned[w.cat]++; if (state.learned[w.w].box >= 4) mastered++; }
    });
    el("st-total").textContent = total;
    el("st-learned").textContent = learned;
    el("st-mastered").textContent = mastered;
    el("st-streak").textContent = state.streak;
    var html = "";
    CATS.forEach(function (c) {
      var pct = catTotal[c] ? Math.round((catLearned[c] / catTotal[c]) * 100) : 0;
      html +=
        '<div class="cat-row"><div class="name">' + esc(WORD_CAT_LABELS[c]) + "</div>" +
        '<div class="bar"><i style="width:' + pct + '%;background:var(--green)"></i></div>' +
        '<div class="pct">' + catLearned[c] + "/" + catTotal[c] + "</div></div>";
    });
    el("st-cats").innerHTML = html;
  }

  // ---------- 设置 ----------
  function applySettings() {
    el("set-perday").value = state.plan.perDay;
    el("listen-range").value = state.settings.range;
    el("listen-order").value = state.settings.order;
    el("listen-rate").value = state.settings.rate;
    el("rate-val").textContent = state.settings.rate.toFixed(1) + "×";
    el("listen-gap").value = state.settings.gap;
    el("gap-val").textContent = state.settings.gap + " 秒";
    // 例句中文切换 + A-B 区间
    var btn = el("ex-zh-toggle");
    if (btn) {
      btn.classList.toggle("on", !!state.settings.showExZh);
      btn.textContent = state.settings.showExZh ? "隐藏例句中文" : "显示例句中文";
    }
    // 一键朗读范围 / 首字母 / 每词次数
    var rm = el("readall-mode"); if (rm) rm.value = state.settings.readallMode || "all";
    var rl = el("readall-letter"); if (rl) rl.value = state.settings.readallLetter || "A";
    var rr = el("readall-reps"); if (rr) { rr.value = String(state.settings.readallReps || 3); el("reps-val").textContent = (state.settings.readallReps || 3) + " 次"; }
    var ab = state.settings.ab || { on: false, a: 1, b: 850 };
    el("readall-ab-a").value = ab.a;
    el("readall-ab-b").value = ab.b;
    syncReadallMode();
    refreshPersonalBtn();
    var ll = el("loop-listen");
    if (ll) ll.checked = !!state.settings.loopListen;
    var ka = el("set-keepawake");
    if (ka) ka.checked = !!state.settings.keepAwake;
  }
  function exportProgress() {
    var data = JSON.stringify(state);
    var blob = new Blob([data], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "be850-progress-" + todayLocal() + ".json";
    a.click();
  }
  function importProgress(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var s = JSON.parse(r.result);
        if (!s || !s.learned) throw 0;
        state = s; save(); rollover(); applySettings(); renderAll();
        alert("进度已恢复");
      } catch (e) { alert("文件格式不正确"); }
    };
    r.readAsText(file);
  }

  // ---------- 渲染全部 ----------
  function renderAll() {
    renderLearn();
    renderStats();
    renderWords();
    renderPos();
    renderGrammar();
    renderPhonics();
  }

  // ---------- 初始化 ----------
  function init() {
    state = load() || defaultState();
    if (!state.settings) state.settings = defaultState().settings;
    if (!state.plan) state.plan = defaultState().plan;
    if (!state.personal) state.personal = [];
    rollover();
    applySettings();
    renderAll();

    // 导航
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () { showView(this.dataset.view); });
    }
    // 返回主界面
    var bh = el("back-home");
    if (bh) bh.addEventListener("click", function () { showView("learn"); });
    // 基础学习子标签（词性 / 语法 / 音标）
    var psTabs = document.querySelectorAll(".ps-tab");
    for (var pi = 0; pi < psTabs.length; pi++) {
      psTabs[pi].addEventListener("click", function () { switchPosTab(this.getAttribute("data-pos")); });
    }
    // 听学
    el("listen-play").addEventListener("click", onBigPlayClick);
    el("readall-play").addEventListener("click", startReadAll);
    el("readall-restart").addEventListener("click", restartReadAll);
    // 音标：一键朗读全部 + 停止
    var pr = el("phonics-readall"); if (pr) pr.addEventListener("click", playAllPhonics);
    var ps = el("phonics-stop"); if (ps) ps.addEventListener("click", function () {
      phonicsRunId++;            // 使当前朗读链失效
      stopAudio();
      el("phonics-status").textContent = "已停止";
    });
    // 语法：一键朗读全部 + 停止
    var gr = el("grammar-readall"); if (gr) gr.addEventListener("click", playAllGrammar);
    var gs = el("grammar-stop"); if (gs) gs.addEventListener("click", function () {
      grammarRunId++;           // 使当前朗读链失效
      stopAudio();
      el("grammar-status").textContent = "已停止";
    });
    el("nav-prev").addEventListener("click", function () { navGoto(-1); });
    el("nav-next").addEventListener("click", function () { navGoto(1); });
    updateNavInfo();
    el("readall-rounds").addEventListener("change", function () { var v = parseInt(this.value, 10); readAllRounds = (v === 0) ? 0 : (v || 3); });
    el("ex-zh-toggle").addEventListener("click", toggleExZh);
    // 个人单词库按钮
    el("personal-btn").addEventListener("click", togglePersonal);
    // 一键朗读：范围模式 / 首字母 / 每词次数
    var letterSel = el("readall-letter");
    if (letterSel) {
      var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
      letterSel.innerHTML = "";
      letters.forEach(function (L) {
        var o = document.createElement("option");
        o.value = L; o.textContent = L + " 开头";
        letterSel.appendChild(o);
      });
      letterSel.value = state.settings.readallLetter || "A";
    }
    el("readall-mode").addEventListener("change", function () {
      state.settings.readallMode = this.value; save(); syncReadallMode();
    });
    el("readall-letter").addEventListener("change", function () {
      state.settings.readallLetter = this.value; save();
    });
    el("readall-reps").addEventListener("change", function () {
      state.settings.readallReps = parseInt(this.value, 10) || 3;
      el("reps-val").textContent = state.settings.readallReps + " 次"; save();
    });
    el("readall-ab-a").addEventListener("change", function () {
      state.settings.ab.a = Math.max(1, Math.min(WORDS.length, parseInt(this.value, 10) || 1));
      this.value = state.settings.ab.a; save();
    });
    el("readall-ab-b").addEventListener("change", function () {
      var v = Math.min(WORDS.length, Math.max(1, parseInt(this.value, 10) || WORDS.length));
      state.settings.ab.b = v; this.value = v; save();
    });
    // 断点续读：若上次有未完成的朗读进度，按钮提示"继续朗读"
    var ra0 = state.readAll || {};
    if (ra0.done !== true && typeof ra0.idx === "number" && ra0.idx < WORDS.length) {
      el("readall-play").textContent = "▶ 继续朗读（断点续读）";
    }
    updateReadAllHint();
    // 听学断点续读：若上次有未完成的听学进度，大按钮提示"继续听学"
    var ls0 = state.listen || {};
    if (ls0.done !== true && typeof ls0.idx === "number" && ls0.idx > 0) {
      var bp = el("listen-play");
      if (bp) { bp.textContent = "▶"; bp.title = "继续听学（断点续读）"; }
    }
    updateListenHint();
    el("listen-range").addEventListener("change", function () { state.settings.range = this.value; save(); state.listen = { idx: 0, done: true }; save(); updateListenHint(); });
    el("listen-order").addEventListener("change", function () { state.settings.order = this.value; save(); });
    el("listen-rate").addEventListener("input", function () {
      state.settings.rate = parseFloat(this.value); el("rate-val").textContent = this.value + "×"; save();
    });
    el("listen-gap").addEventListener("input", function () {
      state.settings.gap = parseInt(this.value, 10); el("gap-val").textContent = this.value + " 秒"; save();
    });
    el("loop-listen").addEventListener("change", function () { state.settings.loopListen = this.checked; save(); });
    el("set-keepawake").addEventListener("change", function () { state.settings.keepAwake = this.checked; save(); });
    msSetup();
    // 小短文复习
    el("passage-gen").addEventListener("click", genPassage);
    el("passage-play").addEventListener("click", playPassage);
    el("passage-source").addEventListener("change", function () {
      var isFriends = this.value === "friends";
      var fw = el("friends-wrap"); if (fw) fw.style.display = isFriends ? "block" : "none";
      if (!isFriends) { var v = el("friends-vocab"); if (v) v.innerHTML = ""; }
      genPassage();
    });
    el("passage-count").addEventListener("change", genPassage);
    // 老友记词表筛选/搜索
    var fvf = el("friends-vocab-filter");
    if (fvf) fvf.addEventListener("change", renderFriendsVocab);
    var fvs = el("friends-vocab-search");
    if (fvs) fvs.addEventListener("input", renderFriendsVocab);
    var pzt = el("passage-zh-toggle");
    if (pzt) {
      var pzOn = state.settings.passageShowZh !== false;
      pzt.textContent = pzOn ? "隐藏中文" : "显示中文";
      pzt.addEventListener("click", function () {
        var on = !(state.settings.passageShowZh !== false);
        state.settings.passageShowZh = on; save();
        this.textContent = on ? "隐藏中文" : "显示中文";
        var zhs = el("passage-list").querySelectorAll(".ps-zh");
        for (var zi = 0; zi < zhs.length; zi++) zhs[zi].classList.toggle("hidden", !on);
      });
    }

    // 搜索
    el("word-search").addEventListener("input", function () { curSearch = this.value; renderWords(); });
    // 词库：手风琴展开 + 单词朗读 + 加入个人库（事件委托，避免重复绑定）
    var wl = el("word-list");
    if (wl && !wl.dataset.bound) {
      wl.dataset.bound = "1";
      wl.addEventListener("click", function (e) {
        var t = e.target;
        var spk = t.closest ? t.closest("[data-spk]") : null;
        if (spk) { sayEnWord(spk.getAttribute("data-spk")); return; }
        var pin = t.closest ? t.closest("[data-personal]") : null;
        if (pin) { togglePersonalWord(pin.getAttribute("data-personal")); return; }
        var head = t.closest ? t.closest("[data-list]") : null;
        if (head) { var id = head.getAttribute("data-list"); expandedLists[id] = !expandedLists[id]; renderWords(); return; }
      });
    }
    // 设置
    el("set-perday").addEventListener("change", function () {
      var v = parseInt(this.value, 10); if (v < 1) v = 1; if (v > 50) v = 50;
      state.plan.perDay = v; this.value = v; save();
    });
    el("set-voice").addEventListener("change", function () { state.settings.voice = this.value; save(); });
    el("btn-export").addEventListener("click", exportProgress);
    el("btn-import").addEventListener("click", function () { el("import-file").click(); });
    el("import-file").addEventListener("change", function () {
      if (this.files[0]) importProgress(this.files[0]);
    });
    el("btn-reset").addEventListener("click", function () {
      if (confirm("确定重置全部学习进度？此操作不可撤销。")) {
        state = defaultState(); rollover(); applySettings(); renderAll();
        alert("已重置");
      }
    });

    if ("speechSynthesis" in window) {
      loadVoices();
      if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = loadVoices;
    }
    // PWA：仅在 http(s) 下注册
    if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
