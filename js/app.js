/* Domino — app logic, wired to the Agent lane contracts (server.py).
   Arc: sign in -> /next (session 1: astronaut) -> stumble -> isolate the
   target CHUNK, trace+voice it letter by letter -> say the whole word ->
   /result -> agent distills a Skill -> /next (session 2: asteroid) arrives
   PRE-CHUNKED. That round-trip is the demo.
   Stage hotkeys: P perfect read · M stumble on target · L pass letter ·
   W word said · K give up (sends resolved:false -> curveball). */

const $ = (id) => document.getElementById(id);
const S = {
  sessionN: 1, skill: null, lastResolved: true,
  activity: null, rem: null, remStart: 0,
  matched: [], targets: [],
  letterIdx: 0, trail: [], strokes: 0, penOK: false, voiceOK: false, checkLatch: false,
  phase: "idle", // sentence | letter | word | between | wrap
  finger: null, hand: null,
  stats: { sentences: 0, fixed: 0, letters: 0 },
  stream: null, hands: null, camera: null, rafOn: false,
  rec: null, speechOn: false, session: false, lastCoach: 0,
};

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}
function speak(text, rate = 0.9) {
  return new Promise((res) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate; u.pitch = 1.1; u.onend = res;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
      setTimeout(res, 400 + text.length * 90);
    } catch (e) { res(); }
  });
}
const norm = (w) => w.toLowerCase().replace(/[^a-z]/g, "");
let toastTimer = null;
function toast(text, ms = 4200) {
  const el = $("toast");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), ms);
}

const LETTER_NAMES = {
  a: ["a","hey","ay","eh"], b: ["b","be","bee"], c: ["c","see","sea","si"],
  d: ["d","de","dee"], e: ["e","he","ee","ye"], f: ["f","ef"], g: ["g","gee","je"],
  h: ["h","aitch","age"], i: ["i","eye","hi","ai"], j: ["j","jay"], k: ["k","kay","okay"],
  l: ["l","el","elle","al"], m: ["m","em","am"], n: ["n","en","and","in"],
  o: ["o","oh","owe","0"], p: ["p","pee","pea"], q: ["q","cue","queue"],
  r: ["r","are","our","ar"], s: ["s","es","yes","ass"], t: ["t","tea","tee"],
  u: ["u","you","yu","ooh"], v: ["v","vee","we","ve"], w: ["w"], x: ["x","ex"],
  y: ["y","why"], z: ["z","zee","zed"],
};

/* ================= SIGN IN ================= */
$("btn-leo").onclick = async () => {
  $("btn-leo").disabled = true;
  await startCamera();
  startSpeech();
  S.session = true;
  speak("Hi Leo! Just you and me today. Read out loud, nice and steady.");
  fetchNext();
};
$("btn-restart").onclick = () => location.reload();

async function fetchNext() {
  const activity = await apiNext({
    learner: LEARNER, skill: S.skill,
    session_n: S.sessionN, last_resolved: S.lastResolved,
  });
  startSentence(activity);
}

/* ================= CAMERA ================= */
async function startCamera() {
  if (S.stream) return;
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    $("cam").srcObject = S.stream;
    $("trace-cam").srcObject = S.stream;
  } catch (e) { console.warn("camera unavailable — mouse tracing fallback"); }
}
function videoToScreen(lm) {
  const v = $("trace-cam");
  const vw = v.videoWidth || 640, vh = v.videoHeight || 480;
  const cw = window.innerWidth, ch = window.innerHeight;
  const s = Math.max(cw / vw, ch / vh);
  const ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
  return { x: ox + (1 - lm.x) * vw * s, y: oy + lm.y * vh * s };
}

/* ================= ALWAYS-ON SPEECH ================= */
function startSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { S.speechOn = false; setReadStatus("mic off — auto mode", false); return; }
  const rec = new SR();
  rec.lang = "en-US"; rec.continuous = true; rec.interimResults = true;
  rec.onresult = (e) => {
    let full = "";
    for (const r of e.results) full += " " + r[0].transcript;
    const tokens = full.toLowerCase().split(/\s+/).map(norm).filter(Boolean);
    if (S.phase === "sentence") matchTranscript(tokens);
    else if (S.phase === "letter") checkLetterSpeech(tokens);
    else if (S.phase === "word") checkWordSpeech(tokens);
  };
  rec.onend = () => { if (S.session) { try { rec.start(); } catch (e) {} } };
  rec.onerror = (e) => { if (e.error === "not-allowed") { S.speechOn = false; setReadStatus("mic off — auto mode", false); } };
  try { rec.start(); S.speechOn = true; } catch (e) { S.speechOn = false; }
  S.rec = rec;
}

/* ================= READING (auto karaoke, prechunk-aware) ================= */
function startSentence(activity) {
  S.activity = activity;
  S.phase = "sentence";
  show("screen-reading");
  const words = activity.sentence.split(/\s+/);
  S.targets = words.map(norm);
  S.matched = words.map(() => false);
  $("sentence").innerHTML = words.map((w, i) => {
    if (activity.prechunk && norm(w) === activity.target_word) {
      /* the Skill payoff: the hard word arrives already chunked */
      const inner = activity.syllables
        .map((s2) => s2 === activity.target_chunk ? `<em class="chunk">${s2}</em>` : s2)
        .join(`<b class="chunk-dot">·</b>`);
      const tail = w.replace(/^[\w]+/, "");
      return `<span class="w" data-i="${i}">${inner}${tail}</span>`;
    }
    return `<span class="w" data-i="${i}">${w}</span>`;
  }).join(" ");
  $("dots").innerHTML = [1, 2]
    .map((n) => `<span class="dot ${n < S.sessionN ? "done" : n === S.sessionN ? "now" : ""}"></span>`).join("");
  paintWords();
  setReadStatus(S.speechOn ? "listening" : "mic off — press P", S.speechOn);
  if (activity.prechunk) toast(`agent pre-chunked “${activity.target_word}” — it learned Leo's pattern`);
}
function setReadStatus(label, live) {
  $("status-read-label").textContent = label;
  $("status-read").classList.toggle("live", live);
}
function paintWords() {
  const nowIdx = S.matched.indexOf(false);
  document.querySelectorAll("#sentence .w").forEach((el, i) => {
    el.className = "w " + (S.matched[i] === true ? "done" : S.matched[i] === "miss" ? "miss" : i === nowIdx ? "now" : "");
  });
}
function matchTranscript(tokens) {
  let ti = 0;
  for (let i = 0; i < S.targets.length && ti < tokens.length; ) {
    if (S.matched[i] !== false) { i++; continue; }
    if (tokens[ti] === S.targets[i]) { S.matched[i] = true; i++; ti++; }
    else if (i + 1 < S.targets.length && tokens[ti] === S.targets[i + 1]) { S.matched[i] = "miss"; i++; }
    else ti++;
  }
  paintWords();
  if (S.matched.every((m) => m !== false)) finishSentence();
}
function simulateRead(withMiss) {
  let i = 0;
  const iv = setInterval(() => {
    if (i >= S.targets.length) { clearInterval(iv); finishSentence(); return; }
    S.matched[i] = (withMiss && S.targets[i] === S.activity.target_word) ? "miss" : true;
    paintWords(); i++;
  }, 320);
}
async function finishSentence() {
  if (S.phase !== "sentence") return;
  S.phase = "between";
  S.stats.sentences++;
  const missed = S.targets.filter((w, i) => S.matched[i] === "miss");
  if (!missed.length) {
    speak(S.activity.prechunk ? "Perfect! The chunks helped — every word!" : "Perfect! Every word!");
    S.lastResolved = true;
    advanceSession();
    return;
  }
  /* build the remediation from the agent's data (or /break for a novel word) */
  let rem;
  if (missed.includes(S.activity.target_word)) {
    rem = { word: S.activity.target_word, syllables: S.activity.syllables,
            chunk: S.activity.target_chunk, chunkPos: S.activity.chunk_position };
  } else {
    const b = await apiBreak(missed[0]);
    rem = { word: missed[0], syllables: b.syllables, chunk: b.target_chunk, chunkPos: b.chunk_position };
  }
  rem.letters = rem.chunk.split("");
  S.rem = rem;
  startTraceChunk();
}
function advanceSession() {
  setTimeout(() => {
    S.sessionN++;
    if (S.sessionN > 2) showWrap();
    else fetchNext();
  }, 800);
}

/* ================= REMEDIATION: isolate the chunk, trace + voice it ======= */
function startTraceChunk() {
  S.phase = "letter";
  S.remStart = Date.now();
  show("screen-trace");
  const r = S.rem;
  $("syllables").innerHTML = r.syllables
    .map((syl) => `<span class="syl ${syl === r.chunk ? "stress" : ""}">${syl}</span>`)
    .join(`<span class="syl-dot">·</span>`);
  S.letterIdx = 0; resetLetter();
  renderLetterStage();
  speak(`${r.syllables.join(". ")}. This chunk is the tricky part: ${r.chunk}. Let's build it in the air.`);
  ensureHands();
  startOverlayLoop();
}
function resetLetter() { S.trail = []; S.strokes = 0; S.checkLatch = false; S.penOK = false; S.voiceOK = !S.speechOn; paintInd(); }
function renderLetterStage() {
  const r = S.rem;
  if (S.phase === "letter") {
    const l = r.letters[S.letterIdx];
    const size = Math.floor(Math.min(window.innerHeight * 0.52, window.innerWidth * 0.42));
    $("letter-row").innerHTML =
      `<span class="letter-box big now" data-i="${S.letterIdx}" style="width:${Math.floor(size * 0.85)}px;height:${Math.floor(size * 1.15)}px;font-size:${size}px">${l}<span class="ind"><i class="pen"></i><i class="voice"></i></span></span>`;
    $("trace-progress").textContent = `chunk “${r.chunk}” · letter ${S.letterIdx + 1} of ${r.letters.length}`;
    $("trace-hint").textContent = `draw the ${l} with one finger, say “${l}”, then show two fingers`;
    $("status-trace").textContent = S.speechOn ? "watching and listening" : "watching (mic off)";
    paintInd();
  } else if (S.phase === "word") {
    const gap = Math.max(6, Math.min(24, Math.floor(window.innerWidth * 0.012)));
    const w = Math.max(44, Math.min(150, Math.floor((window.innerWidth * 0.94 - gap * (r.word.length - 1)) / r.word.length)));
    $("letter-row").style.gap = gap + "px";
    $("letter-row").innerHTML = r.word.split("")
      .map((l) => `<span class="letter-box done" style="width:${w}px;height:${Math.floor(w * 1.3)}px;font-size:${Math.floor(w * 0.82)}px">${l}</span>`).join("");
  }
}
window.addEventListener("resize", () => { if ($("screen-trace").classList.contains("active")) renderLetterStage(); });
function paintInd() {
  const box = document.querySelector(`.letter-box[data-i="${S.letterIdx}"]`);
  if (!box) return;
  box.querySelector(".pen").classList.toggle("on", S.penOK);
  box.querySelector(".voice").classList.toggle("on", S.voiceOK);
}
function activeRect() {
  const box = document.querySelector(`.letter-box[data-i="${S.letterIdx}"]`);
  return box ? box.getBoundingClientRect() : null;
}
function checkLetterSpeech(tokens) {
  if (S.phase !== "letter") return;
  const target = S.rem.letters[S.letterIdx];
  const names = LETTER_NAMES[target] || [target];
  if (tokens.slice(-6).some((tok) => names.includes(tok))) {
    if (!S.voiceOK) { S.voiceOK = true; paintInd(); maybeCompleteLetter(); }
  }
}

/* ---- character recognition (Air-Writing-and-Character-Recognition style) ---- */
const BOUNDRYINC = 12;
function rasterizeTrail(trail) {
  const pts = trail.filter(Boolean);
  if (pts.length < 8) return null;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  pts.forEach((p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
  minX -= BOUNDRYINC; minY -= BOUNDRYINC; maxX += BOUNDRYINC; maxY += BOUNDRYINC;
  const w = Math.max(24, maxX - minX), h = Math.max(24, maxY - minY);
  const c1 = document.createElement("canvas");
  c1.width = w; c1.height = h;
  const x1 = c1.getContext("2d");
  x1.strokeStyle = "#fff"; x1.lineCap = "round"; x1.lineJoin = "round";
  x1.lineWidth = Math.max(6, Math.min(w, h) * 0.12);
  x1.beginPath();
  let pen = false;
  for (const p of trail) {
    if (!p) { pen = false; continue; }
    if (!pen) { x1.moveTo(p.x - minX, p.y - minY); pen = true; }
    else x1.lineTo(p.x - minX, p.y - minY);
  }
  x1.stroke();
  return to28(c1);
}
function to28(srcCanvas) {
  const c2 = document.createElement("canvas"); c2.width = 28; c2.height = 28;
  c2.getContext("2d").drawImage(srcCanvas, 0, 0, 28, 28);
  const c3 = document.createElement("canvas"); c3.width = 48; c3.height = 48;
  c3.getContext("2d").drawImage(c2, 10, 10, 28, 28);
  const c4 = document.createElement("canvas"); c4.width = 28; c4.height = 28;
  const x4 = c4.getContext("2d");
  x4.drawImage(c3, 0, 0, 28, 28);
  const d = x4.getImageData(0, 0, 28, 28).data;
  const v = new Float32Array(784);
  for (let i = 0; i < 784; i++) v[i] = d[i * 4 + 3] > 0 ? d[i * 4] / 255 : 0;
  return v;
}
const GLYPH28 = {};
function glyphTemplate(ch) {
  if (GLYPH28[ch]) return GLYPH28[ch];
  const c = document.createElement("canvas");
  c.width = 220; c.height = 260;
  const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.font = "bold 180px Verdana";
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(ch, 110, 140);
  const img = x.getImageData(0, 0, 220, 260).data;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (let py = 0; py < 260; py++) for (let px = 0; px < 220; px++) {
    if (img[(py * 220 + px) * 4 + 3] > 60) {
      minX = Math.min(minX, px); minY = Math.min(minY, py);
      maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
    }
  }
  const cc = document.createElement("canvas");
  cc.width = maxX - minX + 2 * BOUNDRYINC; cc.height = maxY - minY + 2 * BOUNDRYINC;
  cc.getContext("2d").drawImage(c, minX - BOUNDRYINC, minY - BOUNDRYINC, cc.width, cc.height, 0, 0, cc.width, cc.height);
  GLYPH28[ch] = to28(cc);
  return GLYPH28[ch];
}
const ALPHA = "abcdefghijklmnopqrstuvwxyz".split("");
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < 784; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}
function predictLetter(v28) {
  let best = "?", bestS = -1;
  for (const ch of ALPHA) {
    const s = cosine(v28, glyphTemplate(ch));
    if (s > bestS) { bestS = s; best = ch; }
  }
  return { label: best, score: bestS };
}
/* what an unfinished multi-stroke letter looks like (i missing its dot reads
   as l, t missing its cross reads as l, ...) — coach forward, don't erase */
const INCOMPLETE = { i: ["l","j"], j: ["i","l"], t: ["l","i"], f: ["l","t"], k: ["l"], x: ["v","y"], e: ["c"], q: ["o","a"], b: ["l"], d: ["l","a"], a: ["o"], g: ["o","a","q"] };
function evaluateTrace() {
  if (S.phase !== "letter" || S.penOK) return;
  const target = S.rem.letters[S.letterIdx];
  const v = rasterizeTrail(S.trail);
  if (!v) return;
  const pred = predictLetter(v);
  if (pred.label === target) {
    S.penOK = true; paintInd();
    maybeCompleteLetter();
  } else if ((INCOMPLETE[target] || []).includes(pred.label)) {
    speak(`Almost there — finish the ${target}!`);
    S.checkLatch = false;   // strokes kept; add the dot/cross and check again
  } else {
    speak(`Hmm, that looked like ${pred.label}. Let's try ${target} again.`);
    S.trail = []; S.strokes = 0; S.checkLatch = false;
  }
}
function maybeCompleteLetter() {
  const r = S.rem;
  if (!(S.penOK && S.voiceOK)) {
    if (S.penOK && !S.voiceOK) $("trace-hint").textContent = `great drawing — now say “${r.letters[S.letterIdx]}”`;
    if (!S.penOK && S.voiceOK) $("trace-hint").textContent = `I heard it! now draw the ${r.letters[S.letterIdx]}`;
    return;
  }
  S.stats.letters++;
  speak(r.letters[S.letterIdx] + "!");
  S.letterIdx++;
  if (S.letterIdx >= r.letters.length) startWordStage();
  else { resetLetter(); renderLetterStage(); }
}

/* ---- word stage: say the whole word, retry until correct ---- */
function startWordStage() {
  S.phase = "word";
  renderLetterStage();
  const r = S.rem;
  $("trace-progress").textContent = `you built “${r.chunk}”`;
  $("trace-hint").textContent = "now say the whole word";
  $("status-trace").textContent = S.speechOn ? "listening for the word" : "mic off — press W";
  speak(`${r.chunk}! Now put it together: ${r.syllables.join(". ")}. Say the whole word.`);
}
function checkWordSpeech(tokens) {
  if (S.phase !== "word") return;
  const r = S.rem;
  if (tokens.slice(-8).includes(r.word)) return wordCorrect();
  const letterNames = new Set(Object.values(LETTER_NAMES).flat());
  const attempt = tokens.slice(-8).filter((x) => !letterNames.has(x) && x.length > 2);
  if (attempt.length && Date.now() - S.lastCoach > 4000) {
    S.lastCoach = Date.now();
    speak(`So close! ${r.syllables.join(". ")}. Say it: ${r.word}.`);
  }
}
async function wordCorrect() {
  if (S.phase !== "word") return;
  S.phase = "between";
  const r = S.rem;
  S.stats.fixed++;
  document.querySelectorAll(".letter-box").forEach((el) => el.classList.add("celebrate"));
  speak(`${r.word}! You got it!`);
  sendResult(true);
}
async function sendResult(resolved) {
  const r = S.rem;
  const res = await apiResult({
    stumble_word: r.word,
    failed_chunk: r.chunk,
    chunk_position: r.chunkPos,
    traced_correctly: resolved,
    voiced_while_tracing: S.speechOn && resolved,
    resolved,
    latency_ms: Date.now() - S.remStart,
  });
  if (res.distill_skill && res.skill_text) {
    S.skill = res.skill_text;
    toast("agent learned a skill — saved to memory. next hard word arrives pre-chunked.");
  } else if (res.next_move) {
    toast(`agent: ${res.next_move}`);
  }
  S.lastResolved = resolved;
  if (resolved) advanceSession();
  else setTimeout(fetchNext, 900); // curveball path: same session, easier word
}

/* ================= OVERLAY ================= */
function startOverlayLoop() {
  if (S.rafOn) return;
  S.rafOn = true;
  requestAnimationFrame(drawOverlay);
}
function drawOverlay() {
  if (!$("screen-trace").classList.contains("active")) { S.rafOn = false; return; }
  const c = $("trace-overlay");
  if (c.width !== window.innerWidth || c.height !== window.innerHeight) {
    c.width = window.innerWidth; c.height = window.innerHeight;
  }
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  const r = S.phase === "letter" ? activeRect() : null;
  if (r) {
    ctx.strokeStyle = "rgba(217,185,140,0.95)"; ctx.lineWidth = 5;
    ctx.setLineDash([12, 10]); ctx.lineDashOffset = -performance.now() / 40;
    ctx.strokeRect(r.left - 8, r.top - 8, r.width + 16, r.height + 16);
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = "#7EC4EE"; ctx.lineWidth = 12; ctx.lineCap = "round"; ctx.lineJoin = "round";
  let stroke = [];
  const strokes = [];
  for (const p of S.trail) {
    if (!p) { if (stroke.length) strokes.push(stroke); stroke = []; }
    else stroke.push(p);
  }
  if (stroke.length) strokes.push(stroke);
  for (const st of strokes) {
    ctx.beginPath();
    if (st.length < 3) {
      ctx.moveTo(st[0].x, st[0].y);
      ctx.lineTo(st[st.length - 1].x + 0.1, st[st.length - 1].y + 0.1);
    } else {
      ctx.moveTo(st[0].x, st[0].y);
      for (let i = 1; i < st.length - 1; i++) {
        const mx = (st[i].x + st[i + 1].x) / 2, my = (st[i].y + st[i + 1].y) / 2;
        ctx.quadraticCurveTo(st[i].x, st[i].y, mx, my);
      }
      ctx.lineTo(st[st.length - 1].x, st[st.length - 1].y);
    }
    ctx.stroke();
  }
  if (S.hand) {
    ctx.strokeStyle = "rgba(251,246,236,0.85)"; ctx.lineWidth = 3;
    const CONN = window.HAND_CONNECTIONS || [];
    for (const [a, b] of CONN) {
      const pa = videoToScreen(S.hand[a]), pb = videoToScreen(S.hand[b]);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    ctx.fillStyle = "rgba(126,196,238,0.9)";
    for (const lm of S.hand) {
      const p = videoToScreen(lm);
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (S.finger) {
    ctx.beginPath();
    ctx.arc(S.finger.x, S.finger.y, 16, 0, Math.PI * 2);
    if (S.finger.pinch) { ctx.fillStyle = "#7EC4EE"; ctx.fill(); }
    else { ctx.strokeStyle = "#D9B98C"; ctx.lineWidth = 6; ctx.stroke(); }
  }
  requestAnimationFrame(drawOverlay);
}

/* ================= HANDS ================= */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
async function ensureHands() {
  if (S.hands) return;
  if (!S.stream) { $("status-trace").textContent = "no camera — draw with your mouse"; return; }
  try {
    await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js");
    await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");
    const hands = new Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
    hands.onResults(onHands);
    const video = $("trace-cam");
    const camera = new Camera(video, { onFrame: async () => { await hands.send({ image: video }); }, width: 640, height: 480 });
    camera.start();
    S.hands = hands; S.camera = camera;
  } catch (e) { $("status-trace").textContent = "hand tracking offline — mouse works"; }
}
function rawPose(lm) {
  /* margins add hysteresis so the pose doesn't flicker at the joint boundary */
  const idxUp = lm[8].y < lm[6].y - 0.02;
  const midUp = lm[12].y < lm[10].y - 0.02;
  const midDown = lm[12].y > lm[10].y;
  if (idxUp && midUp) return "check";
  if (idxUp && midDown) return "draw";
  return "idle";
}
const POSE_N = { draw: 2, check: 5, idle: 3 };  // frames needed to ENTER each mode
function stablePose(p) {
  S.poseHist = S.poseHist || [];
  S.poseHist.push(p);
  if (S.poseHist.length > 6) S.poseHist.shift();
  const need = POSE_N[p];
  if (S.poseHist.length >= need && S.poseHist.slice(-need).every((x) => x === p)) S.pose = p;
  return S.pose || "idle";
}
function onHands(results) {
  const lm = results.multiHandLandmarks && results.multiHandLandmarks[0];
  if (!lm) {
    S.hand = null;
    penUp();
    S.finger = null;
    S.checkLatch = false;
    S.smoothTip = null;
    S.poseHist = [];
    paintGestureLegend("idle");
    return;
  }
  S.hand = lm;
  const raw = videoToScreen(lm[8]);
  /* exponential smoothing kills fingertip jitter */
  S.smoothTip = S.smoothTip
    ? { x: S.smoothTip.x * 0.5 + raw.x * 0.5, y: S.smoothTip.y * 0.5 + raw.y * 0.5 }
    : raw;
  const tip = S.smoothTip;
  const pose = stablePose(rawPose(lm));
  S.finger = { x: tip.x, y: tip.y, pinch: pose === "draw" };
  paintGestureLegend(pose);
  if (S.phase === "letter") {
    if (pose === "draw") {
      const last = [...S.trail].reverse().find(Boolean);
      const isNewStroke = !S.trail.length || S.trail[S.trail.length - 1] === null;
      /* min-distance filter: ignore sub-5px jitter, but always start a stroke */
      if (isNewStroke || !last || Math.hypot(tip.x - last.x, tip.y - last.y) > 2.5) {
        S.trail.push({ x: tip.x, y: tip.y });
      }
      $("status-trace").textContent = "drawing";
      S.checkLatch = false;
    } else if (pose === "check") {
      penUp();
      if (!S.checkLatch && S.trail.filter(Boolean).length >= 6) {
        S.checkLatch = true;
        $("status-trace").textContent = "checking…";
        evaluateTrace();
      }
    } else {
      penUp();
      S.checkLatch = false;
      $("status-trace").textContent = "one finger to draw · two to check";
    }
  }
}
function paintGestureLegend(pose) {
  const legend = $("gesture-legend");
  if (!legend) return;
  legend.querySelector(".g-draw").classList.toggle("on", pose === "draw");
  legend.querySelector(".g-check").classList.toggle("on", pose === "check");
}
function penUp() {
  if (S.trail.length && S.trail[S.trail.length - 1] !== null) {
    /* a tap (the dot of an i or j) leaves 1-2 points — inflate it into a small
       blob so it survives the 28x28 rasterization */
    let n = 0;
    for (let i = S.trail.length - 1; i >= 0 && S.trail[i] !== null; i--) n++;
    if (n <= 2) {
      const p = S.trail[S.trail.length - 1];
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
        S.trail.push({ x: p.x + Math.cos(a) * 5, y: p.y + Math.sin(a) * 5 });
      }
    }
    S.trail.push(null);
    S.strokes++;
  }
}
(function mouseFallback() {
  const c = $("trace-overlay");
  let down = false, evalTimer = null;
  c.addEventListener("pointerdown", (e) => { down = true; S.trail.push({ x: e.clientX, y: e.clientY }); });
  c.addEventListener("pointermove", (e) => {
    if (!$("screen-trace").classList.contains("active")) return;
    if (!S.hands) S.finger = { x: e.clientX, y: e.clientY, pinch: down };
    if (down) S.trail.push({ x: e.clientX, y: e.clientY });
  });
  const up = () => {
    if (down) {
      down = false; penUp();
      clearTimeout(evalTimer);
      evalTimer = setTimeout(() => evaluateTrace(), 700);
    }
  };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointerleave", up);
})();

/* ================= STAGE HOTKEYS ================= */
document.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (S.phase === "sentence") {
    if (k === "p") simulateRead(false);
    if (k === "m") simulateRead(true);
  } else if (S.phase === "letter") {
    if (k === "l") { S.penOK = true; S.voiceOK = true; paintInd(); maybeCompleteLetter(); }
    if (k === "k") { S.phase = "between"; sendResult(false); }
  } else if (S.phase === "word") {
    if (k === "w") wordCorrect();
    if (k === "k") { S.phase = "between"; sendResult(false); }
  }
});

/* ================= WRAP ================= */
function showWrap() {
  S.phase = "wrap"; S.session = false;
  try { S.rec && S.rec.stop(); } catch (e) {}
  show("screen-wrap");
  $("wrap-stats").innerHTML = [
    `${S.stats.sentences} sentences read`,
    `${S.stats.fixed} tricky words rebuilt`,
    `${S.stats.letters} letters drawn and spoken`,
  ].map((x) => `<span class="wrap-stat">${x}</span>`).join("");
  if (S.skill) $("wrap-memory").textContent = `Skill saved to memory: “${S.skill}”`;
  speak("Quest complete! Your reading brain grew today. See you next time!");
}
