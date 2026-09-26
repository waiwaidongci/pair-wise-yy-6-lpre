import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "ink-stick-testing.json");
const port = Number(process.env.PORT || 3037);

const STATUSES = ["待试磨", "待复磨", "已试磨", "重点观察"];
const SEDIMENTS = ["无", "少", "较多", "多"];
const SPEEDS = ["慢", "中", "快"];

const profileFields = [
  ["code", "墨锭编号", "text"],
  ["smokeSource", "烟料来源", "text"],
  ["glueRatio", "胶料比例", "text"],
  ["ageYears", "存放年限", "number"],
  ["storage", "存放位置", "text"],
];
const testFields = [
  ["paper", "试磨纸张", "text"],
  ["water", "加水量", "text"],
  ["speed", "出墨速度", "select", SPEEDS],
  ["colorLayer", "墨色层次", "text"],
  ["sediment", "沉淀情况", "select", SEDIMENTS],
  ["score", "评分", "number"],
];

function gradeOf(score) {
  return score >= 85 ? "优" : score >= 75 ? "良" : "差";
}

// 沉淀按 无<少<较多<多 量化，复磨时与所选上一次结果比较
function sedimentLevel(name) {
  return SEDIMENTS.indexOf(name);
}

// 试磨判定（沉淀未减少 -> 待复磨；>=85且沉淀减少 -> 已试磨；连续两次<75 -> 重点观察）
function applyTest(item, input, at) {
  const round = item.tests.length + 1;
  let baseRound = null;
  let base = null;
  if (item.tests.length > 0) {
    baseRound = Number(input.baseRound);
    base = item.tests.find((t) => t.round === baseRound);
    if (!base) return { error: "base_round_not_found" };
  }
  const level = sedimentLevel(input.sediment);
  const delta = base ? (level < base.sedimentLevel ? "less" : level > base.sedimentLevel ? "more" : "same") : null;
  const score = Number(input.score);
  const test = {
    round,
    at,
    baseRound,
    paper: input.paper,
    water: input.water,
    speed: input.speed,
    colorLayer: input.colorLayer,
    sediment: input.sediment,
    sedimentLevel: level,
    sedimentDelta: delta,
    score,
    grade: gradeOf(score),
  };
  item.tests.push(test);

  const lastTwo = item.tests.slice(-2).map((t) => t.score);
  if (lastTwo.length === 2 && lastTwo.every((s) => s < 75)) {
    item.status = "重点观察";
    test.message = `连续两轮评分低于75（${lastTwo[0]}、${lastTwo[1]}），转重点观察`;
  } else if (score >= 85 && (base === null || delta === "less")) {
    item.status = "已试磨";
    test.message = base === null
      ? `首次试磨评分${score}，沉淀无历史基准，记为已试磨`
      : `沉淀较第${baseRound}轮减少且评分${score}≥85，记为已试磨`;
  } else {
    item.status = "待复磨";
    if (base === null) test.message = `首次试磨评分${score}，进入待复磨队列`;
    else if (delta !== "less") test.message = `沉淀较第${baseRound}轮未减少，进入待复磨队列`;
    else test.message = `沉淀较第${baseRound}轮减少，但评分${score}未达85，继续待复磨`;
  }

  item.logs.push({
    at,
    step: `第${round}轮试磨`,
    note: `${input.paper}，${input.water}，出墨${input.speed}，沉淀${input.sediment}，评分${score}（${test.grade}）-> ${item.status}`,
  });
  return { test };
}

function buildSeed() {
  const mk = (code, smokeSource, glueRatio, ageYears, storage, createdAt) => ({
    id: "seed-" + code,
    code,
    smokeSource,
    glueRatio,
    ageYears,
    storage,
    status: "待试磨",
    createdAt,
    tests: [],
    logs: [{ at: createdAt, step: "建档", note: "创建墨锭" }],
  });
  const items = [
    mk("IS-001", "黄山松烟", "7.5%", 8, "恒湿柜B", "2026-09-08T09:00:00.000Z"),
    mk("IS-002", "桐油烟", "8%", 3, "试样盒C", "2026-09-10T09:00:00.000Z"),
    mk("IS-003", "黄山松烟", "9%", 1, "试样盒A", "2026-09-12T09:00:00.000Z"),
    mk("IS-004", "漆烟", "7%", 5, "恒湿柜A", "2026-09-15T09:00:00.000Z"),
  ];
  const run = (item, baseRound, paper, water, speed, colorLayer, sediment, score, day) =>
    applyTest(item, { baseRound, paper, water, speed, colorLayer, sediment, score }, day);

  // IS-001：首次评分86 -> 已试磨
  run(items[0], null, "宣纸", "20滴", "快", "乌黑发亮，层次分明", "少", 86, "2026-09-09T02:30:00.000Z");
  // IS-002：首轮72沉淀较多，复磨沉淀减少但78分 -> 待复磨
  run(items[1], null, "棉连纸", "18滴", "中", "偏暖，层次尚可", "较多", 72, "2026-09-16T02:30:00.000Z");
  run(items[1], 1, "棉连纸", "16滴", "中", "偏暖，层次拉开", "少", 78, "2026-09-20T02:30:00.000Z");
  // IS-003：连续两轮低于75 -> 重点观察
  run(items[2], null, "毛边纸", "24滴", "慢", "发灰，层次模糊", "多", 70, "2026-09-17T02:30:00.000Z");
  run(items[2], 1, "毛边纸", "22滴", "慢", "发灰略改善", "较多", 68, "2026-09-21T02:30:00.000Z");
  // IS-004：尚未试磨
  return { items };
}

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(buildSeed(), null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}
async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}
function newId() {
  return "IS-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}
function decorate(item) {
  const last = item.tests.at(-1) || null;
  return {
    ...item,
    testCount: item.tests.length,
    lastRound: last ? last.round : 0,
    lastAt: last ? last.at : null,
    latestGrade: last ? last.grade : null,
    latestScore: last ? last.score : null,
  };
}
function computeStats(items) {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let totalScore = 0;
  let totalTests = 0;
  for (const item of items) {
    if (byStatus[item.status] !== undefined) byStatus[item.status] += 1;
    for (const t of item.tests) {
      totalScore += t.score;
      totalTests += 1;
    }
  }
  return {
    total: items.length,
    totalTests,
    byStatus,
    pendingRegrind: byStatus["待复磨"],
    focusWatch: byStatus["重点观察"],
    finished: byStatus["已试磨"],
    averageScore: totalTests ? Math.round((totalScore / totalTests) * 10) / 10 : null,
  };
}

function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>墨锭试磨室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --orange:#b4762a; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:0; font-size:17px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; align-items:start; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; margin-top:14px; width:100%; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; margin-top:4px; }
    .stat.highlight { border-color:var(--orange); background:#fdf6ec; } .stat.highlight strong { color:var(--orange); }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:150px; flex:1; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .rules { font-size:12px; color:var(--muted); line-height:1.7; border-top:1px dashed var(--line); margin-top:12px; padding-top:10px; }
    .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 9px; font-size:12px; white-space:nowrap; }
    .pill.s-已试磨 { background:#eef5e8; color:#3f5c31; border-color:#bcd3ad; } .pill.s-待复磨 { background:#fdf6ec; color:var(--orange); border-color:#e5c99a; }
    .pill.s-重点观察 { background:#f8eae6; color:var(--warn); border-color:#dcb3a8; } .pill.s-待试磨 { background:#f0f1ef; color:var(--muted); }
    .g-优 { color:#3f5c31; font-weight:700; } .g-良 { color:#34598f; font-weight:700; } .g-差 { color:var(--warn); font-weight:700; }
    .tests { border-top:1px solid var(--line); padding-top:8px; display:grid; gap:8px; }
    .test { border:1px solid var(--line); border-radius:6px; padding:8px 10px; font-size:13px; display:grid; gap:3px; background:#fbfcfa; }
    .test .top { display:flex; justify-content:space-between; gap:8px; font-weight:700; }
    .delta-less { color:#3f5c31; } .delta-same { color:var(--orange); } .delta-more { color:var(--warn); }
    .msg { display:none; border-radius:6px; padding:10px 12px; margin-top:12px; font-size:13px; line-height:1.6; } .msg.ok { display:block; background:#eef5e8; color:#3f5c31; border:1px solid #bcd3ad; } .msg.err { display:block; background:#f8eae6; color:var(--warn); border:1px solid #dcb3a8; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>墨锭试磨室</h1><div class="meta">墨锭建档 · 连续试磨 · 复磨判定 · 评分统计</div></div>
    <button id="reload" style="width:auto;margin:0;">刷新</button>
  </header>
  <main>
    <section>
      <form id="createForm">
        <h2>墨锭建档</h2>
        <div id="profileFields"></div>
        <button>保存墨锭</button>
      </form>
      <form id="testForm" class="panel" style="margin-top:14px;padding:16px;">
        <h2>提交试磨结果</h2>
        <label>选择墨锭</label>
        <select name="itemId" id="itemSelect"></select>
        <label>前一次结果（复磨基准）</label>
        <select name="baseRound" id="baseSelect"></select>
        <div class="meta" id="baseHint"></div>
        <div id="testFields"></div>
        <button>提交试磨</button>
        <div class="msg" id="testMsg"></div>
        <div class="rules">
          判定规则：沉淀较所选上一次结果未减少 → <b>待复磨</b>；评分≥85且沉淀减少 → <b>已试磨</b>（首次试磨无沉淀基准，仅看评分）；连续两轮评分低于75 → <b>重点观察</b>。
        </div>
      </form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar">
        <select id="statusFilter"><option value="">全部状态</option>${STATUSES.map((s) => "<option>" + s + "</option>").join("")}</select>
        <select id="gradeFilter"><option value="">全部评级</option><option>优</option><option>良</option><option>差</option></select>
        <select id="sortSelect"><option value="created">建档顺序</option><option value="latest-desc">最近试磨（新→旧）</option><option value="latest-asc">最近试磨（旧→新）</option></select>
        <input id="search" placeholder="搜索编号 / 烟料 / 位置">
      </div>
      <div class="panel"><h2>试磨结果回看</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <script>
    const STATUSES = ${JSON.stringify(STATUSES)};
    const profileFields = ${JSON.stringify(profileFields)};
    const testFields = ${JSON.stringify(testFields)};
    const $ = (sel) => document.querySelector(sel);
    const createForm = $('#createForm');
    const testForm = $('#testForm');
    const itemSelect = $('#itemSelect');
    const baseSelect = $('#baseSelect');
    let items = [];
    let stats = null;

    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers: { 'Content-Type': 'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
    function fmtDate(at) { return at ? at.slice(0, 10) : '—'; }
    function esc(v) { return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

    function renderForms() {
      $('#profileFields').innerHTML = profileFields.map(([key, label, type]) =>
        '<label>' + label + '</label><input name="' + key + '" type="' + type + '"' + (key === 'code' ? ' required' : '') + '>'
      ).join('');
      $('#testFields').innerHTML = testFields.map(([key, label, type, options]) => {
        if (type === 'select') {
          return '<label>' + label + '</label><select name="' + key + '" required>' +
            '<option value="">请选择</option>' + options.map((o) => '<option>' + o + '</option>').join('') + '</select>';
        }
        const extra = key === 'score' ? ' min="0" max="100" required' : ' required';
        return '<label>' + label + '</label><input name="' + key + '" type="' + type + '"' + extra + '>';
      }).join('');
    }

    function renderItemSelect() {
      const prev = itemSelect.value;
      itemSelect.innerHTML = items.map((i) =>
        '<option value="' + i.id + '">' + esc(i.code) + ' · ' + esc(i.smokeSource) + ' · ' + i.status + '</option>'
      ).join('');
      if (prev && items.some((i) => i.id === prev)) itemSelect.value = prev;
      renderBaseSelect();
    }
    function currentItem() { return items.find((i) => i.id === itemSelect.value); }
    function renderBaseSelect() {
      const item = currentItem();
      if (!item) { baseSelect.innerHTML = ''; $('#baseHint').textContent = ''; return; }
      if (item.tests.length === 0) {
        baseSelect.innerHTML = '<option value="">首次试磨（无沉淀基准）</option>';
        $('#baseHint').textContent = '该墨锭尚未试磨，首次结果不比较沉淀，评分≥85即记为已试磨。';
      } else {
        baseSelect.innerHTML = item.tests.map((t) =>
          '<option value="' + t.round + '">第' + t.round + '轮结果｜沉淀' + t.sediment + '｜评分' + t.score + '</option>'
        ).join('');
        baseSelect.value = String(item.tests.at(-1).round);
        updateBaseHint();
      }
    }
    function updateBaseHint() {
      const item = currentItem();
      const t = item && item.tests.find((x) => x.round === Number(baseSelect.value));
      $('#baseHint').textContent = t
        ? '以第' + t.round + '轮为基准（沉淀：' + t.sediment + '，评分：' + t.score + '），本次沉淀少于「' + t.sediment + '」才算减少。'
        : '';
    }

    function renderStats() {
      if (!stats) return;
      const cards = [
        ['待复磨', stats.pendingRegrind, true],
        ['平均分', stats.averageScore ?? '—', false],
        ['已试磨', stats.finished, false],
        ['重点观察', stats.focusWatch, false],
        ['待试磨', stats.byStatus['待试磨'], false],
        ['试磨总次数', stats.totalTests, false],
      ];
      $('#stats').innerHTML = cards.map(([label, value, hot]) =>
        '<div class="stat' + (hot ? ' highlight' : '') + '"><span>' + label + '</span><strong>' + value + '</strong></div>'
      ).join('');
    }

    function deltaHtml(t) {
      if (t.sedimentDelta === null) return '<span class="meta">首次基准</span>';
      const map = {
        less: ['delta-less', '↓ 较第' + t.baseRound + '轮减少'],
        same: ['delta-same', '＝ 与第' + t.baseRound + '轮持平'],
        more: ['delta-more', '↑ 较第' + t.baseRound + '轮增多'],
      };
      const [cls, text] = map[t.sedimentDelta];
      return '<span class="' + cls + '">' + text + '</span>';
    }
    function testHtml(t) {
      return '<div class="test"><div class="top"><span>第' + t.round + '轮 · ' + fmtDate(t.at) +
        '</span><span>评分 ' + t.score + ' <span class="g-' + t.grade + '">' + t.grade + '</span></span></div>' +
        '<div>' + esc(t.paper) + '｜' + esc(t.water) + '｜出墨' + esc(t.speed) + '</div>' +
        '<div class="meta">墨色层次：' + esc(t.colorLayer) + '</div>' +
        '<div>沉淀：' + t.sediment + ' ' + deltaHtml(t) + '</div></div>';
    }
    function cardHtml(item) {
      const head = '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">' +
        '<h3>' + esc(item.code) + '</h3>' +
        '<span class="pill s-' + item.status + '">' + item.status + '</span></div>';
      const profile = '<div class="meta">' + esc(item.smokeSource) + '｜胶 ' + esc(item.glueRatio) +
        '｜陈放 ' + esc(item.ageYears) + ' 年｜' + esc(item.storage) + '</div>';
      const grade = item.latestGrade
        ? '<div class="meta">最近：第' + item.lastRound + '轮 ' + fmtDate(item.lastAt) +
          '，评分 ' + item.latestScore + ' <span class="g-' + item.latestGrade + '">' + item.latestGrade + '</span></div>'
        : '<div class="meta">共 ' + item.testCount + ' 轮试磨，尚未试磨</div>';
      const tests = item.tests.length
        ? '<div class="tests">' + [...item.tests].reverse().map(testHtml).join('') + '</div>'
        : '<div class="tests meta">暂无试磨记录</div>';
      return '<article class="card">' + head + profile + grade + tests + '</article>';
    }

    function renderCards() {
      const status = $('#statusFilter').value;
      const grade = $('#gradeFilter').value;
      const q = $('#search').value.trim().toLowerCase();
      const sort = $('#sortSelect').value;
      let visible = items.filter((item) =>
        (!status || item.status === status) &&
        (!grade || item.latestGrade === grade) &&
        (!q || [item.code, item.smokeSource, item.storage, item.glueRatio].join(' ').toLowerCase().includes(q))
      );
      visible.sort((a, b) => {
        if (sort === 'created') return a.createdAt < b.createdAt ? -1 : 1;
        const ta = a.lastAt || '';
        const tb = b.lastAt || '';
        if (sort === 'latest-desc') return ta < tb ? 1 : ta > tb ? -1 : 0;
        if (!ta || !tb) return ta ? 1 : tb ? -1 : 0;
        return ta < tb ? -1 : 1;
      });
      $('#cards').innerHTML = visible.length ? visible.map(cardHtml).join('') : '<div class="meta">没有符合条件的墨锭</div>';
    }

    function showMsg(text, ok) {
      const el = $('#testMsg');
      el.className = 'msg ' + (ok ? 'ok' : 'err');
      el.textContent = text;
    }

    async function load() {
      [items, stats] = await Promise.all([api('/api/items'), api('/api/stats')]);
      renderItemSelect();
      renderStats();
      renderCards();
    }

    createForm.onsubmit = async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(createForm).entries());
      try {
        await api('/api/items', { method: 'POST', body: JSON.stringify(data) });
        createForm.reset();
        await load();
        itemSelect.value = items[0] && items.find((i) => i.code === data.code)?.id;
        renderBaseSelect();
        showMsg('墨锭 ' + data.code + ' 建档成功，状态：待试磨', true);
      } catch (e) { alert(e.message); }
    };

    testForm.onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(testForm);
      const payload = {
        itemId: form.get('itemId'),
        baseRound: form.get('baseRound') ? Number(form.get('baseRound')) : null,
        paper: form.get('paper'),
        water: form.get('water'),
        speed: form.get('speed'),
        colorLayer: form.get('colorLayer'),
        sediment: form.get('sediment'),
        score: Number(form.get('score')),
      };
      try {
        const result = await api('/api/items/' + encodeURIComponent(payload.itemId) + '/tests', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        testForm.reset();
        await load();
        itemSelect.value = payload.itemId;
        renderBaseSelect();
        showMsg(result.message, result.item.status === '已试磨');
      } catch (e) {
        showMsg(e.message, false);
      }
    };

    itemSelect.onchange = renderBaseSelect;
    baseSelect.onchange = updateBaseHint;
    $('#statusFilter').onchange = renderCards;
    $('#gradeFilter').onchange = renderCards;
    $('#sortSelect').onchange = renderCards;
    $('#search').oninput = renderCards;
    $('#reload').onclick = load;

    renderForms();
    load();
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();

    if (req.method === "GET" && url.pathname === "/") return html(res, page());

    if (req.method === "GET" && url.pathname === "/api/items") {
      return send(res, 200, db.items.map(decorate));
    }

    if (req.method === "POST" && url.pathname === "/api/items") {
      const input = await body(req);
      const code = String(input.code || "").trim();
      if (!code) return send(res, 400, { error: "code_required" });
      if (db.items.some((x) => x.code === code)) return send(res, 409, { error: "code_duplicated" });
      const now = new Date().toISOString();
      const item = {
        id: newId(),
        code,
        smokeSource: String(input.smokeSource || "").trim(),
        glueRatio: String(input.glueRatio || "").trim(),
        ageYears: input.ageYears === "" || input.ageYears === undefined ? null : Number(input.ageYears),
        storage: String(input.storage || "").trim(),
        status: "待试磨",
        createdAt: now,
        tests: [],
        logs: [{ at: now, step: "建档", note: "创建墨锭" }],
      };
      db.items.push(item);
      await saveDb(db);
      return send(res, 201, decorate(item));
    }

    const submit = url.pathname.match(/^\/api\/items\/([^/]+)\/tests$/);
    if (submit && req.method === "POST") {
      const item = db.items.find((x) => x.id === submit[1] || x.code === submit[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      const score = Number(input.score);
      if (!Number.isFinite(score) || score < 0 || score > 100) return send(res, 400, { error: "score_invalid" });
      if (!SEDIMENTS.includes(input.sediment)) return send(res, 400, { error: "sediment_invalid" });
      if (!SPEEDS.includes(input.speed)) return send(res, 400, { error: "speed_invalid" });
      for (const [key] of [["paper"], ["water"], ["colorLayer"]]) {
        if (!String(input[key] || "").trim()) return send(res, 400, { error: key + "_required" });
      }
      item.tests ||= [];
      item.logs ||= [];
      const result = applyTest(item, input, new Date().toISOString());
      if (result.error) return send(res, 400, { error: result.error });
      await saveDb(db);
      return send(res, 201, { item: decorate(item), test: result.test, message: result.test.message });
    }

    const detail = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (detail && req.method === "GET") {
      const item = db.items.find((x) => x.id === detail[1] || x.code === detail[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      return send(res, 200, decorate(item));
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      return send(res, 200, computeStats(db.items));
    }

    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log("墨锭试磨室 listening on http://localhost:" + port));
