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
    if (!("speechSynthesis" in window)) { if (cb) setTimeout(cb, 10); return; }
    var u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = lang === "zh-CN" ? state.settings.rate * 0.9 : state.settings.rate;
    var v = pickVoice(lang === "zh-CN" ? "zh" : "en");
    if (v) u.voice = v;
    try { speechSynthesis.cancel(); } catch (e) {}
    speechSynthesis.speak(u);
    var est = Math.max(700, text.length * (lang === "zh-CN" ? 130 : 70) / state.settings.rate);
    setTimeout(function () { if (cb) cb(); }, est);
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
  function passagePool() {
    var mode = el("passage-source") ? el("passage-source").value : "all";
    var pool = [];
    if (mode === "personal") {
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
      if (!passageSentences.length) genPassage();
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
  function buildListenList() {
    var range = state.settings.range, list = [];
    if (range === "learned") {
      for (var i = 0; i < WORDS.length; i++) if (state.learned[WORDS[i].w]) list.push(WORDS[i]);
    } else if (range === "today") {
      state.today.tasks.forEach(function (id) {
        for (var j = 0; j < WORDS.length; j++) if (WORDS[j].w === id) { list.push(WORDS[j]); break; }
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
        el("listen-play").textContent = "▶";
        el("listen-status").textContent = "播放完成 ✓";
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
    // 对一个单词循环朗读「单词→词性→中文→例句」N 遍，再下一个（N=每词朗读次数）
    var reps = parseInt(state.settings.readallReps, 10) || 3;
    playSeqReps(item, reps, function () {
      listenTimer = setTimeout(function () { listenTimer = null; listenIdx++; listenTick(); }, state.settings.gap * 1000);
    });
  }
  // 两个朗读模式互斥：激活其中一个时，禁用另一个的播放按钮，避免互相串台
  function updateModeButtons() {
    var lp = el("listen-play"), rp = el("readall-play");
    if (readAllPlaying) {
      if (lp) { lp.disabled = true; lp.style.opacity = ".45"; lp.title = "一键朗读进行中，请先停止"; }
      if (rp) { rp.disabled = false; rp.style.opacity = "1"; rp.title = ""; }
    } else if (listenPlaying) {
      if (rp) { rp.disabled = true; rp.style.opacity = ".45"; rp.title = "每日听学进行中，请先停止"; }
      if (lp) { lp.disabled = false; lp.style.opacity = "1"; lp.title = ""; }
    } else {
      if (lp) { lp.disabled = false; lp.style.opacity = "1"; lp.title = ""; }
      if (rp) { rp.disabled = false; rp.style.opacity = "1"; rp.title = ""; }
    }
  }
  function toggleListen() {
    if (listenPlaying) {
      listenPlaying = false;
      if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
      stopAudio();   // 立即掐断当前音频
      el("listen-play").textContent = "▶";
      el("listen-status").textContent = "已暂停";
      releaseWakeLock();
      msSetState(false);
      updateModeButtons();
    } else {
      // 一键朗读进行中：点每日听学按钮只停止一键朗读，不再误启动每日循环
      if (readAllPlaying) { stopReadAll(false); updateModeButtons(); return; }
      if (!HAS_AUDIO && !("speechSynthesis" in window)) { alert("当前环境无法播放语音"); return; }
      listenList = buildListenList();
      if (!listenList.length) { alert("该范围还没有词，先去学习一些吧"); return; }
      listenPlaying = true;
      el("listen-play").textContent = "⏸";
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
    if (mode === "letter") {
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
    { code: "v",    name: "动词",   sym: "v.",   intro: "表示动作或状态，比如 run（跑）、eat（吃）、be（是）、have（有）。句子里通常少不了它。", ex: "He runs every morning." },
    { code: "n",    name: "名词",   sym: "n.",   intro: "表示人、事物、地方或概念，比如 book（书）、water（水）、teacher（老师）、love（爱）。", ex: "The book is on the table." },
    { code: "adj",  name: "形容词", sym: "adj.", intro: "用来描述名词，说明它“是什么样的”，比如 big（大的）、red（红的）、good（好的）。", ex: "She has a big red bag." },
    { code: "adv",  name: "副词",   sym: "adv.", intro: "修饰动词、形容词或其他副词，常表示“怎么、多快、哪里”。很多以 -ly 结尾，比如 quickly（快速地）、very（非常）。", ex: "He speaks very quickly." },
    { code: "aux",  name: "助动词", sym: "aux.", intro: "帮助主要动词表达时态、疑问或否定，比如 can（能）、will（将）、do（做）。", ex: "She can swim very well." },
    { code: "conj", name: "连词",   sym: "conj.",intro: "用来连接词、短语或句子，比如 and（和）、but（但是）、because（因为）。", ex: "I like tea but he likes coffee." },
    { code: "det",  name: "限定词", sym: "det.", intro: "放在名词前面，说明“哪一个 / 多少”，比如 the（这/那）、a（一个）、my（我的）、this（这个）。", ex: "This is my book." },
    { code: "prep", name: "介词",   sym: "prep.",intro: "表示名词和其他词之间的关系，常说明位置、时间、方向，比如 in（在…里）、on（在…上）、to（到）、with（和…一起）。", ex: "The cat is on the chair." },
    { code: "pron", name: "代词",   sym: "pron.",intro: "用来代替名词，避免重复，比如 I（我）、he（他）、it（它）、they（他们）。", ex: "He gave it to them." }
  ];
  function renderPos() {
    var html = "";
    POS_LESSONS.forEach(function (l) {
      html +=
        '<div class="pos-card" id="pos-card-' + l.code + '">' +
          '<div class="pos-head"><span class="pos-name">' + l.name + '</span><span class="lc-pos">' + l.sym + '</span></div>' +
          '<div class="pos-intro">' + esc(l.intro) + '</div>' +
          '<div class="pos-ex">📘 ' + esc(l.ex) + '</div>' +
          '<button class="pos-play" data-code="' + l.code + '">🔊 朗读这个词性</button>' +
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
    // 高亮当前卡片
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
    playMp3("audio/pos_" + l.code + ".mp3", function () {
      playMp3("audio/pos_intro_" + l.code + ".mp3", function () {
        playMp3("audio/pos_ex_" + l.code + ".mp3", function () { done(); });
      });
    });
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
    // 听学
    el("listen-play").addEventListener("click", toggleListen);
    el("readall-play").addEventListener("click", startReadAll);
    el("readall-restart").addEventListener("click", restartReadAll);
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
    // 断点续读：若上次有未完成的朗读进度，按钮提示“继续朗读”
    var ra0 = state.readAll || {};
    if (ra0.done !== true && typeof ra0.idx === "number" && ra0.idx < WORDS.length) {
      el("readall-play").textContent = "▶ 继续朗读（断点续读）";
    }
    updateReadAllHint();
    el("listen-range").addEventListener("change", function () { state.settings.range = this.value; save(); });
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
    el("passage-source").addEventListener("change", genPassage);
    el("passage-count").addEventListener("change", genPassage);
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
