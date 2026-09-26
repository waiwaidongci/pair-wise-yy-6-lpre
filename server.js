import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "ink-stick-testing.json");
const port = Number(process.env.PORT || 3037);

// 沉淀按等级量化，试磨时与所选前一次结果对比，判断沉淀是否减少
const SEDIMENT_SCALE = [["无", 0], ["少", 1], ["中", 2], ["多", 3]];
const sedimentLevelOf = new Map(SEDIMENT_SCALE);
const STAGES = ["待试磨", "待复磨", "已试磨", "重点观察"];
const PASS_SCORE = 85; // 评分达标线
const LOW_SCORE = 75; // 连续两次低于此分转重点观察

const profileFields = [
  ["code", "墨锭编号", "text"],
  ["smokeSource", "烟料来源", "text"],
  ["glueRatio", "胶料比例", "text"],
  ["ageYears", "存放年限", "number"],
  ["storage", "存放位置", "text"]
];
const testFields = [
  ["paper", "试磨纸张", "text"],
  ["water", "加水量", "text"],
  ["speed", "出墨速度", "select", ["快", "中", "慢"]],
  ["colorLayer", "墨色层次", "text"],
  ["sediment", "沉淀情况", "select", SEDIMENT_SCALE.map(([label]) => label)],
  ["score", "评分", "number"]
];

const seed = {
  "items": [
    {
      "id": "IS-001",
      "code": "IS-001",
      "smokeSource": "黄山松烟",
      "glueRatio": "7.5%",
      "ageYears": 8,
      "storage": "恒湿柜B",
      "status": "已试磨",
      "createdAt": "2026-05-02T09:00:00.000Z",
      "logs": [
        { "at": "2026-05-02T09:00:00.000Z", "step": "建档", "note": "墨锭建档，状态：待试磨" },
        { "at": "2026-06-05T10:00:00.000Z", "step": "试磨", "note": "第1次：宣纸22滴，沉淀多，评分80 → 待复磨（评分未达85）", "score": 80 },
        { "at": "2026-06-20T10:00:00.000Z", "step": "试磨", "note": "第2次：棉连纸20滴，沉淀少（较第1次减少），评分88 → 已试磨（评分达标且沉淀减少）", "score": 88 }
      ],
      "tests": [
        {
          "seq": 1, "at": "2026-06-05T10:00:00.000Z",
          "paper": "宣纸", "water": "22滴", "speed": "中", "colorLayer": "四层，偏灰",
          "sediment": "多", "sedimentLevel": 3, "score": 80,
          "baselineSeq": null, "sedimentReduced": null, "consecutiveLow": false,
          "result": "待复磨", "reason": "首次试磨评分未达85，进入待复磨队列"
        },
        {
          "seq": 2, "at": "2026-06-20T10:00:00.000Z",
          "paper": "棉连纸", "water": "20滴", "speed": "快", "colorLayer": "五层，乌黑发亮",
          "sediment": "少", "sedimentLevel": 1, "score": 88,
          "baselineSeq": 1, "sedimentReduced": true, "consecutiveLow": false,
          "result": "已试磨", "reason": "评分达到85且沉淀减少，记为已试磨"
        }
      ]
    },
    {
      "id": "IS-002",
      "code": "IS-002",
      "smokeSource": "桐油烟",
      "glueRatio": "8%",
      "ageYears": 3,
      "storage": "试样盒C",
      "status": "待复磨",
      "createdAt": "2026-05-10T09:00:00.000Z",
      "logs": [
        { "at": "2026-05-10T09:00:00.000Z", "step": "建档", "note": "墨锭建档，状态：待试磨" },
        { "at": "2026-06-08T10:00:00.000Z", "step": "试磨", "note": "第1次：宣纸20滴，沉淀中，评分82 → 待复磨（评分未达85）", "score": 82 },
        { "at": "2026-06-22T10:00:00.000Z", "step": "试磨", "note": "第2次：净皮纸18滴，沉淀中（与第1次持平），评分83 → 待复磨（沉淀没有减少）", "score": 83 }
      ],
      "tests": [
        {
          "seq": 1, "at": "2026-06-08T10:00:00.000Z",
          "paper": "宣纸", "water": "20滴", "speed": "快", "colorLayer": "四层，偏暖",
          "sediment": "中", "sedimentLevel": 2, "score": 82,
          "baselineSeq": null, "sedimentReduced": null, "consecutiveLow": false,
          "result": "待复磨", "reason": "首次试磨评分未达85，进入待复磨队列"
        },
        {
          "seq": 2, "at": "2026-06-22T10:00:00.000Z",
          "paper": "净皮纸", "water": "18滴", "speed": "中", "colorLayer": "四层，暖紫",
          "sediment": "中", "sedimentLevel": 2, "score": 83,
          "baselineSeq": 1, "sedimentReduced": false, "consecutiveLow": false,
          "result": "待复磨", "reason": "沉淀没有减少，继续留在待复磨队列"
        }
      ]
    },
    {
      "id": "IS-003",
      "code": "IS-003",
      "smokeSource": "工业炭黑",
      "glueRatio": "9%",
      "ageYears": 1,
      "storage": "试样盒A",
      "status": "重点观察",
      "createdAt": "2026-05-18T09:00:00.000Z",
      "logs": [
        { "at": "2026-05-18T09:00:00.000Z", "step": "建档", "note": "墨锭建档，状态：待试磨" },
        { "at": "2026-06-10T10:00:00.000Z", "step": "试磨", "note": "第1次：宣纸24滴，沉淀多，评分72 → 待复磨（评分未达85）", "score": 72 },
        { "at": "2026-06-24T10:00:00.000Z", "step": "试磨", "note": "第2次：毛边纸22滴，沉淀中（较第1次减少），评分70 → 重点观察（连续两次低于75）", "score": 70 }
      ],
      "tests": [
        {
          "seq": 1, "at": "2026-06-10T10:00:00.000Z",
          "paper": "宣纸", "water": "24滴", "speed": "慢", "colorLayer": "三层，发灰",
          "sediment": "多", "sedimentLevel": 3, "score": 72,
          "baselineSeq": null, "sedimentReduced": null, "consecutiveLow": false,
          "result": "待复磨", "reason": "首次试磨评分未达85，进入待复磨队列"
        },
        {
          "seq": 2, "at": "2026-06-24T10:00:00.000Z",
          "paper": "毛边纸", "water": "22滴", "speed": "慢", "colorLayer": "三层，欠浓",
          "sediment": "中", "sedimentLevel": 2, "score": 70,
          "baselineSeq": 1, "sedimentReduced": true, "consecutiveLow": true,
          "result": "重点观察", "reason": "连续两次评分低于75，转重点观察"
        }
      ]
    },
    {
      "id": "IS-004",
      "code": "IS-004",
      "smokeSource": "漆烟",
      "glueRatio": "7%",
      "ageYears": 5,
      "storage": "恒湿柜A",
      "status": "待试磨",
      "createdAt": "2026-06-02T09:00:00.000Z",
      "logs": [
        { "at": "2026-06-02T09:00:00.000Z", "step": "建档", "note": "墨锭建档，状态：待试磨" }
      ],
      "tests": []
    }
  ]
};

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  normalizeDb(db);
  return db;
}
function normalizeDb(db) {
  db.items ||= [];
  for (const item of db.items) {
    item.id ||= item.code;
    item.logs ||= [];
    item.tests ||= [];
    if (!STAGES.includes(item.status)) item.status = item.tests.length ? "待复磨" : "待试磨";
    item.createdAt ||= item.logs[0]?.at || new Date().toISOString();
    item.tests.forEach((test, i) => {
      test.seq ||= i + 1;
      if (test.sedimentLevel == null) test.sedimentLevel = sedimentLevelOf.get(test.sediment) ?? null;
      test.score = Number(test.score) || 0;
    });
  }
}
async function saveDb(db) { await writeFile(dbPath, JSON.stringify(db, null, 2)); }
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function fail(res, status, error) { return send(res, status, { error }); }
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}
function newId() { return "IS-" + Date.now().toString(36).toUpperCase(); }
function gradeOf(score) {
  if (score == null) return "未评";
  if (score >= PASS_SCORE) return "优";
  if (score >= LOW_SCORE) return "良";
  return "差";
}
function latestTest(item) {
  const tests = item.tests || [];
  return tests.length ? tests[tests.length - 1] : null;
}
function summarize(item) {
  const latest = latestTest(item);
  return {
    ...item,
    logs: undefined,
    latestScore: latest ? latest.score : null,
    latestAt: latest ? latest.at : null,
    grade: gradeOf(latest ? latest.score : null)
  };
}
function computeStats(items) {
  const counts = Object.fromEntries(STAGES.map(s => [s, 0]));
  let scoreSum = 0, scored = 0, testCount = 0;
  for (const item of items) {
    if (counts[item.status] !== undefined) counts[item.status] += 1;
    const tests = item.tests || [];
    testCount += tests.length;
    const latest = latestTest(item);
    if (latest) { scoreSum += latest.score; scored += 1; }
  }
  return {
    total: items.length,
    counts,
    testCount,
    regrindCount: counts["待复磨"],
    focusCount: counts["重点观察"],
    testedCount: counts["已试磨"],
    averageScore: scored ? Math.round((scoreSum / scored) * 10) / 10 : null
  };
}

// 连续试磨判定：沉淀相对所选前次结果是否减少；连续两次低于75转重点观察；
// 评分≥85且沉淀减少记为已试磨；沉淀没有减少（或未达标）进入待复磨队列。
function submitTest(item, input) {
  const text = key => String(input[key] ?? "").trim();
  const paper = text("paper"), water = text("water"), speed = text("speed");
  const colorLayer = text("colorLayer"), sediment = text("sediment");
  const score = Number(input.score);
  if (!paper) throw ["paper", "请填写试磨纸张"];
  if (!water) throw ["water", "请填写加水量"];
  if (!speed) throw ["speed", "请选择出墨速度"];
  if (!colorLayer) throw ["colorLayer", "请填写墨色层次"];
  if (!sedimentLevelOf.has(sediment)) throw ["sediment", "请选择沉淀情况（无/少/中/多）"];
  if (!Number.isFinite(score) || score < 0 || score > 100) throw ["score", "评分需为 0-100 的数字"];

  const tests = item.tests ||= [];
  const previous = tests.length ? tests[tests.length - 1] : null;
  let baseline = previous;
  if (input.baselineSeq != null && String(input.baselineSeq) !== "") {
    const seq = Number(input.baselineSeq);
    baseline = tests.find(t => t.seq === seq) || null;
    if (!baseline) throw ["baselineSeq", "所选前一次结果不存在"];
  }

  const level = sedimentLevelOf.get(sediment);
  const sedimentReduced = baseline ? level < baseline.sedimentLevel : null;
  const consecutiveLow = !!previous && previous.score < LOW_SCORE && score < LOW_SCORE;

  let status, reason;
  if (consecutiveLow) {
    status = "重点观察";
    reason = "连续两次评分低于75，转重点观察";
  } else if (score >= PASS_SCORE && sedimentReduced !== false) {
    status = "已试磨";
    reason = baseline ? "评分达到85且沉淀减少，记为已试磨" : "首次试磨评分达到85，记为已试磨";
  } else {
    status = "待复磨";
    reason = sedimentReduced === false
      ? "沉淀没有减少，进入待复磨队列"
      : "评分未达85，进入待复磨队列";
  }

  const at = new Date().toISOString();
  const test = {
    seq: tests.length + 1,
    at,
    paper, water, speed, colorLayer,
    sediment, sedimentLevel: level, score,
    baselineSeq: baseline ? baseline.seq : null,
    sedimentReduced,
    consecutiveLow,
    result: status,
    reason
  };
  tests.push(test);
  item.status = status;
  item.logs ||= [];
  const trend = sedimentReduced === true ? "（较第" + baseline.seq + "次减少）"
    : sedimentReduced === false ? "（与第" + baseline.seq + "次持平或增多）" : "";
  item.logs.push({
    at, step: "试磨",
    note: "第" + test.seq + "次：" + paper + water + "，沉淀" + sediment + trend + "，评分" + score + " → " + status + "（" + reason + "）",
    score
  });
  return test;
}

function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>墨锭试磨室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --gold:#9a7b2f; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:0; font-size:17px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; align-items:start; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; margin-top:14px; width:100%; } button.secondary { background:#69736a; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin-bottom:14px; }
    .stat strong { display:block; font-size:26px; margin-top:2px; } .stat span { color:var(--muted); font-size:13px; }
    .stat.highlight { border-color:var(--warn); } .stat.highlight strong { color:var(--warn); }
    .stat.avg strong { color:var(--accent); }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:150px; flex:1; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; }
    .card { display:grid; gap:8px; padding:14px; }
    .card-head { display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 9px; font-size:12px; white-space:nowrap; }
    .pill.s-待试磨 { color:#69736a; } .pill.s-待复磨 { color:var(--warn); border-color:var(--warn); }
    .pill.s-已试磨 { color:var(--accent); border-color:var(--accent); } .pill.s-重点观察 { color:var(--gold); border-color:var(--gold); }
    .pill.g-优 { color:var(--accent); border-color:var(--accent); } .pill.g-良 { color:var(--gold); border-color:var(--gold); } .pill.g-差 { color:var(--warn); border-color:var(--warn); }
    .tests { display:grid; gap:8px; border-top:1px solid var(--line); padding-top:8px; }
    .test { border:1px solid var(--line); border-radius:6px; padding:8px 10px; display:grid; gap:3px; background:#fafcf8; }
    .test .row1 { display:flex; justify-content:space-between; align-items:center; gap:6px; }
    .down { color:var(--accent); font-weight:700; } .up { color:var(--warn); font-weight:700; } .flat { color:var(--muted); }
    .reason { font-size:12px; } .empty { color:var(--muted); padding:18px; text-align:center; }
    .hint { font-size:12px; margin-top:4px; } #error { color:var(--warn); font-size:13px; min-height:18px; margin-top:8px; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>墨锭试磨室</h1><div class="meta">建档 · 连续试磨 · 沉淀对比 · 评分统计</div></div>
    <button class="secondary" id="reload" style="width:auto;">刷新</button>
  </header>
  <main>
    <section style="display:grid;gap:14px;">
      <form id="createForm">
        <h2>墨锭建档</h2><div id="profileFields"></div>
        <button>保存建档（状态：待试磨）</button>
      </form>
      <form id="testForm">
        <h2>连续试磨</h2>
        <label>选择墨锭</label><select name="id" id="testItem"></select>
        <label>前一次结果（复磨对比基准）</label><select name="baselineSeq" id="baselineSelect"></select>
        <div class="meta hint" id="baselineHint"></div>
        <div id="testFields"></div>
        <div id="error"></div>
        <button>提交试磨结果</button>
      </form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar">
        <select id="statusFilter"><option value="">全部状态</option></select>
        <select id="gradeFilter"><option value="">全部评级</option><option>优</option><option>良</option><option>差</option><option>未评</option></select>
        <select id="sortOrder"><option value="created">按建档顺序</option><option value="recent">最近试磨在前</option><option value="score">评分从高到低</option></select>
        <input id="search" placeholder="搜索编号 / 烟料 / 纸张…">
      </div>
      <div class="panel"><h2>试磨结果</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <datalist id="paperList"><option value="宣纸"><option value="棉连纸"><option value="净皮纸"><option value="毛边纸"><option value="绢"></datalist>
  <script>
    var stages = ["待试磨","待复磨","已试磨","重点观察"];
    var profileFields = ${JSON.stringify(profileFields)};
    var testFields = ${JSON.stringify(testFields)};
    var sedimentLabels = ["无","少","中","多"];
    var createForm = document.querySelector('#createForm');
    var testForm = document.querySelector('#testForm');
    var cards = document.querySelector('#cards');
    var statsEl = document.querySelector('#stats');
    var testItem = document.querySelector('#testItem');
    var baselineSelect = document.querySelector('#baselineSelect');
    var baselineHint = document.querySelector('#baselineHint');
    var errorBox = document.querySelector('#error');
    var items = [];
    var stats = {};

    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
        return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
      });
    }
    function api(path, options) {
      return fetch(path, options && options.body ? Object.assign({}, options, { headers: { 'Content-Type': 'application/json' } }) : options)
        .then(function (res) { return res.json().then(function (data) { if (!res.ok) throw new Error(data.error || '请求失败'); return data; }); });
    }
    function renderFieldDefs() {
      document.querySelector('#profileFields').innerHTML = profileFields.map(function (f) {
        return '<label>' + f[1] + '</label><input name="' + f[0] + '" type="' + f[2] + '"' + (f[0] === 'code' ? ' required' : '') + '>';
      }).join('');
      document.querySelector('#testFields').innerHTML = testFields.map(function (f) {
        if (f[2] === 'select') return '<label>' + f[1] + '</label><select name="' + f[0] + '" required><option value="">请选择</option>' + f[3].map(function (o) { return '<option>' + o + '</option>'; }).join('') + '</select>';
        var extra = f[0] === 'score' ? ' min="0" max="100" step="1" required' : ' required';
        var list = f[0] === 'paper' ? ' list="paperList"' : '';
        return '<label>' + f[1] + '</label><input name="' + f[0] + '" type="' + f[2] + '"' + extra + list + '>';
      }).join('');
    }
    function itemId(item) { return item.id || item.code; }
    function renderBaselineOptions() {
      var item = items.find(function (i) { return itemId(i) === testItem.value; }) || items[0];
      if (item) testItem.value = itemId(item);
      var tests = item ? (item.tests || []) : [];
      baselineSelect.innerHTML = '<option value="">首次试磨（无前次结果）</option>' + tests.map(function (t) {
        return '<option value="' + t.seq + '"' + (t.seq === tests.length ? ' selected' : '') + '>第' + t.seq + '次 · ' + t.at.slice(0, 10) + ' · 沉淀' + t.sediment + ' · 评分' + t.score + '</option>';
      }).join('');
      renderBaselineHint();
    }
    function renderBaselineHint() {
      var item = items.find(function (i) { return itemId(i) === testItem.value; });
      if (!item) { baselineHint.textContent = ''; return; }
      var seq = baselineSelect.value;
      if (!seq) { baselineHint.textContent = '首次试磨无需对比沉淀；评分≥85 直接记为已试磨。'; return; }
      var t = (item.tests || []).find(function (x) { return String(x.seq) === String(seq); });
      baselineHint.textContent = t ? ('基准：第' + t.seq + '次沉淀「' + t.sediment + '」、评分' + t.score + '。本次沉淀需低于该等级才算减少。') : '';
    }
    function sedimentTrend(t) {
      if (t.sedimentReduced === true) return '<span class="down">↓ 较第' + t.baselineSeq + '次减少</span>';
      if (t.sedimentReduced === false) return '<span class="up">↑ 较第' + t.baselineSeq + '次未减少</span>';
      return '<span class="flat">首次记录</span>';
    }
    function testHtml(t) {
      return '<div class="test"><div class="row1"><b>第' + t.seq + '次 · ' + esc(t.at.slice(0, 10)) + '</b><span class="pill s-' + t.result + '">' + t.result + '</span></div>'
        + '<div class="meta">' + esc(t.paper) + ' · ' + esc(t.water) + ' · 出墨' + esc(t.speed) + ' · ' + esc(t.colorLayer) + '</div>'
        + '<div>沉淀<b> ' + esc(t.sediment) + '</b>　' + sedimentTrend(t) + '　评分<b> ' + t.score + '</b></div>'
        + '<div class="meta reason">' + esc(t.reason) + (t.consecutiveLow ? '（连续低分预警）' : '') + '</div></div>';
    }
    function cardHtml(item) {
      var profile = ['烟料 ' + item.smokeSource, '胶比 ' + item.glueRatio, '年限 ' + item.ageYears, item.storage].filter(Boolean).map(esc).join(' · ');
      var tests = (item.tests || []).slice().reverse().map(testHtml).join('');
      return '<article class="card"><div class="card-head"><h3>' + esc(item.code) + '</h3><span><span class="pill s-' + item.status + '">' + item.status + '</span> <span class="pill g-' + item.grade + '">评级' + item.grade + (item.latestScore != null ? '·' + item.latestScore : '') + '</span></span></div>'
        + '<div class="meta">' + profile + '</div>'
        + '<div class="tests">' + (tests || '<div class="meta">暂无试磨记录，建档后可提交首次试磨。</div>') + '</div></article>';
    }
    function render() {
      testItem.innerHTML = items.map(function (item) {
        return '<option value="' + esc(itemId(item)) + '">' + esc(item.code) + ' · ' + esc(item.smokeSource || '') + ' · ' + item.status + '</option>';
      }).join('');
      var keep = testItem.value;
      if (keep) testItem.value = keep;
      renderBaselineOptions();

      statsEl.innerHTML =
        '<div class="stat highlight"><span>待复磨队列</span><strong>' + (stats.regrindCount || 0) + '</strong></div>'
        + '<div class="stat avg"><span>平均分（最近一次）</span><strong>' + (stats.averageScore == null ? '—' : stats.averageScore) + '</strong></div>'
        + stages.filter(function (s) { return s !== '待复磨'; }).map(function (s) {
          return '<div class="stat"><span>' + s + '</span><strong>' + ((stats.counts && stats.counts[s]) || 0) + '</strong></div>';
        }).join('')
        + '<div class="stat"><span>累计试磨次数</span><strong>' + (stats.testCount || 0) + '</strong></div>';

      var status = document.querySelector('#statusFilter').value;
      var grade = document.querySelector('#gradeFilter').value;
      var order = document.querySelector('#sortOrder').value;
      var q = document.querySelector('#search').value.trim();
      var visible = items.filter(function (item) {
        if (status && item.status !== status) return false;
        if (grade && item.grade !== grade) return false;
        if (q && JSON.stringify(item).indexOf(q) === -1) return false;
        return true;
      });
      visible.sort(function (a, b) {
        if (order === 'recent') return String(b.latestAt || '').localeCompare(String(a.latestAt || ''));
        if (order === 'score') return (b.latestScore == null ? -1 : b.latestScore) - (a.latestScore == null ? -1 : a.latestScore);
        return String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.code).localeCompare(String(b.code));
      });
      cards.innerHTML = visible.map(cardHtml).join('') || '<div class="empty">没有符合条件的墨锭</div>';
    }
    function load() {
      var keep = testItem.value;
      return Promise.all([api('/api/items'), api('/api/stats')])
        .then(function (results) {
          items = results[0]; stats = results[1];
          testItem.value = keep;
          render();
        })
        .catch(function (err) { errorBox.textContent = err.message; });
    }

    document.querySelector('#statusFilter').innerHTML += stages.map(function (s) { return '<option>' + s + '</option>'; }).join('');
    testItem.onchange = renderBaselineOptions;
    baselineSelect.onchange = renderBaselineHint;
    document.querySelector('#statusFilter').onchange = render;
    document.querySelector('#gradeFilter').onchange = render;
    document.querySelector('#sortOrder').onchange = render;
    document.querySelector('#search').oninput = render;
    document.querySelector('#reload').onclick = function () { load(); };

    createForm.onsubmit = function (event) {
      event.preventDefault();
      errorBox.textContent = '';
      var data = Object.fromEntries(new FormData(createForm).entries());
      api('/api/items', { method: 'POST', body: JSON.stringify(data) })
        .then(function () { createForm.reset(); return load(); })
        .catch(function (err) { errorBox.textContent = err.message; });
    };
    testForm.onsubmit = function (event) {
      event.preventDefault();
      errorBox.textContent = '';
      var form = new FormData(testForm);
      var id = form.get('id');
      var payload = Object.fromEntries(form.entries());
      delete payload.id;
      api('/api/items/' + encodeURIComponent(id) + '/tests', { method: 'POST', body: JSON.stringify(payload) })
        .then(function () { testForm.reset(); renderFieldDefs(); return load(); })
        .catch(function (err) { errorBox.textContent = err.message; });
    };

    renderFieldDefs();
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
      let list = db.items.map(summarize);
      const status = url.searchParams.get("status");
      const grade = url.searchParams.get("grade");
      const sort = url.searchParams.get("sort") || "created";
      if (status) list = list.filter(i => i.status === status);
      if (grade) list = list.filter(i => i.grade === grade);
      const q = (url.searchParams.get("q") || "").trim();
      if (q) list = list.filter(i => JSON.stringify(i).includes(q));
      list.sort((a, b) => {
        if (sort === "recent") return String(b.latestAt || "").localeCompare(String(a.latestAt || ""));
        if (sort === "score") return (b.latestScore ?? -1) - (a.latestScore ?? -1);
        return String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.code).localeCompare(String(b.code));
      });
      return send(res, 200, list);
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      return send(res, 200, computeStats(db.items));
    }

    if (req.method === "POST" && url.pathname === "/api/items") {
      const input = await readBody(req);
      const code = String(input.code || "").trim();
      if (!code) return fail(res, 400, "墨锭编号必填");
      if (db.items.some(i => i.code === code)) return fail(res, 409, "墨锭编号已存在：" + code);
      const now = new Date().toISOString();
      const item = {
        id: newId(),
        code,
        smokeSource: String(input.smokeSource || "").trim(),
        glueRatio: String(input.glueRatio || "").trim(),
        ageYears: input.ageYears === "" || input.ageYears == null ? null : Number(input.ageYears),
        storage: String(input.storage || "").trim(),
        status: "待试磨",
        createdAt: now,
        logs: [{ at: now, step: "建档", note: "墨锭建档，状态：待试磨" }],
        tests: []
      };
      db.items.push(item);
      await saveDb(db);
      return send(res, 201, summarize(item));
    }

    const detail = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (detail && req.method === "GET") {
      const item = db.items.find(x => x.id === detail[1] || x.code === detail[1]);
      if (!item) return fail(res, 404, "墨锭不存在");
      return send(res, 200, { ...summarize(item), logs: item.logs });
    }

    const testPost = url.pathname.match(/^\/api\/items\/([^/]+)\/tests$/);
    if (testPost && req.method === "POST") {
      const item = db.items.find(x => x.id === testPost[1] || x.code === testPost[1]);
      if (!item) return fail(res, 404, "墨锭不存在");
      const input = await readBody(req);
      let test;
      try {
        test = submitTest(item, input);
      } catch ([field, message]) {
        return send(res, 400, { error: message, field });
      }
      await saveDb(db);
      return send(res, 201, { item: { ...summarize(item), logs: item.logs }, test });
    }

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log("墨锭试磨室 listening on http://localhost:" + port));
