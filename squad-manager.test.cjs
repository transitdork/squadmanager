const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {test} = require('node:test');
const vm = require('node:vm');
const {join} = require('node:path');

const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const version = readFileSync(join(__dirname, '../version.txt'), 'utf8').trim();

function app(storage = new Map()) {
  const mounted = new Map();
  const timers = [];
  const element = tag => ({
    tag, style: {setProperty(name,value) { this[name]=value; }}, classList: {toggle() {}}, dataset: {},
    innerHTML: '', children: [], listeners: {},
    querySelector() { return null; },
    appendChild(child) { this.children.push(child); if(child.id) mounted.set(child.id,child); },
    remove() { if(this.id) mounted.delete(this.id); },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    setAttribute() {}, showModal() {}, focus() {}, select() {},
    close() { this.listeners.close?.(); },
    contentDocument: {open() {}, write(html) { this.html=html; }, close() {}},
  });
  const root = element();
  const view = element();
  const flash = element();
  mounted.set('install-banner',element());
  const wide = {matches: false, addEventListener(_, callback) { this.change = callback; }};
  const context = vm.createContext({
    console, navigator: {}, screen: {}, location: {protocol: 'file:'},
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    document: {
      documentElement: root, body: element(),
      addEventListener() {}, createElement: element,
      getElementById: id => id === 'app' ? view : id === 'flash-el' ? flash : mounted.get(id) || null,
    },
    setTimeout(callback,delay) { timers.push({callback,delay}); return timers.length; }, setInterval() { return 1; },
    clearTimeout() {}, clearInterval() {}, requestAnimationFrame() {},
    MutationObserver: class { observe() {} disconnect() {} },
    matchMedia: query => query.includes('orientation') ? wide : {matches: false, addEventListener() {}},
    addEventListener() {}, confirm: () => true,
  });
  context.window = context;
  for (const script of scripts) vm.runInContext(script, context);
  const run = code => vm.runInContext(code, context);
  const data = code => JSON.parse(run(`JSON.stringify(${code})`));
  return {run, data, storage, view, root, wide, mounted, timers};
}

const roster = ['Ada', 'Bea', 'Cora', 'Di', 'Ella', 'Fran', 'Gwen'];
const rosterCode = `S.names=${JSON.stringify(roster)}`;
const leagueCode = `T.teams=[{id:'team',club:'Example',league:'VJBL',players:[]}]; T.activeTeamId='team'`;
const setLineup = 'for(let i=0;i<5;i++) toggleLineupPlayer(i)';
const onCourt = 'S.players.filter(p=>p.onCourt).map(p=>p.id)';
const waitForClock = (run, seconds) => run(`_lastTickWall=Date.now()-${seconds}*1000; doTick()`);

test('optional starting five: empty court until five are chosen and Start is pressed', () => {
  const {run, data, view} = app();
  assert.match(view.innerHTML, /STARTING 5/);
  assert.doesNotMatch(view.innerHTML, /AI Plan|first 5 start/);
  run(`${rosterCode}; startGame()`);
  assert.match(view.innerHTML, /ON COURT · 0\/5/);
  assert.match(view.innerHTML, /BENCH · 7/);
  assert.match(view.innerHTML, /onclick="finishLineup\(\)" disabled/);
  run('finishLineup()');
  assert.equal(run('S.isRunning'), false);
  run(setLineup);
  run('toggleLineupPlayer(5)');
  assert.deepEqual(data('[...lineupCourt()]'), [0, 1, 2, 3, 4]);
  run('toggleLineupPlayer(0); toggleLineupPlayer(5)');
  assert.deepEqual(data(onCourt), []);
  assert.equal(run('S.gameTime'), 0);
  run('finishLineup()');
  assert.deepEqual(data(onCourt), [1, 2, 3, 4, 5]);
  assert.equal(run('S.isRunning'), true);
  assert.equal(run('S.subLog.length'), 0);
});

test('a preset is editable and follows roster slots without reordering the roster', () => {
  const {run, data, storage} = app();
  run(`${rosterCode}; [1,2,3,4,6].forEach(toggleStartingPlayer); removePlayer(0)`);
  const restored = app(storage);
  restored.run('startGame()');
  assert.deepEqual(restored.data('[...lineupCourt()]'), [0, 1, 2, 3, 5]);
  assert.deepEqual(data('S.names'), roster.slice(1));
  restored.run('toggleLineupPlayer(5); toggleLineupPlayer(4); finishLineup()');
  assert.deepEqual(restored.data(onCourt), [0, 1, 2, 3, 4]);
});

test('VJBL: four separate 10-minute clocks, lineup changes, and no time beyond the buzzer', () => {
  const session=app();
  const {run, data, view, root} = session;
  run(`CFG.layout='landscape'; CFG.uiScale=1.3; applyLayout(); applyUiScale();
    ${leagueCode}; ${rosterCode}; startGame(); ${setLineup}; finishLineup()`);
  assert.equal(root.dataset.layout,'landscape');
  assert.equal(root.style['--ui-scale'],'1.3');
  for (let quarter = 1; quarter <= 4; quarter++) {
    assert.equal(run('getCurrentQuarter()'), `Q${quarter}`);
    assert.equal(run('getPeriodRemaining()'), 600);
    assert.match(view.innerHTML, /Quarter remaining/);
    waitForClock(run, 1);
    assert.equal(run('getPeriodRemaining()'), 599);
    waitForClock(run, 700);
    assert.equal(run('getPeriodRemaining()'), 0);
    assert.equal(run('S.isRunning'), false);
    assert.equal(run('S.gameTime'), quarter * 600);
    if (quarter === 4) break;
    run('endHalf()');
    assert.match(view.innerHTML,/<footer class="ht-footer">/);
    assert.match(view.innerHTML,/ON COURT · 5\/5/);
    const [off,on] = quarter % 2 ? [0,5] : [5,0];
    run(`toggleLineupPlayer(${off}); toggleLineupPlayer(${on})`);
    clickLineupStart(session,`START Q${quarter+1}`);
    assert.equal(run('S.isRunning'), true);
    if (quarter === 1) assert.deepEqual(data(onCourt), [1, 2, 3, 4, 5]);
    if (quarter === 2) assert.deepEqual(data(onCourt), [0, 1, 2, 3, 4]);
  }
  assert.equal(run('S.players.reduce((total,p)=>total+p.playTime,0)'), 12000);
});

function clickLineupStart(session, label){
  const match=session.view.innerHTML.match(/<button type="button" class="ht-start" onclick="([^"]+)"([^>]*)>▶ ([^<]+)<\/button>/);
  assert.ok(match,'Start button was rendered');
  assert.equal(match[3],label);
  assert.doesNotMatch(match[2],/disabled/);
  session.run(match[1]);
}

test('Q2, Q3 and Q4 start with a short lineup, including when reopened at the break', () => {
  let session=app();
  session.run(`${leagueCode}; saveTeams(); localStorage.setItem(TEAMS_KEY+'_active','team');
    ${rosterCode}; startGame(); ${setLineup}; finishLineup(); toggleFoul(0,4)`);
  for(const [breakPhase,nextQuarter] of [['q1break',2],['halftime',3],['q3break',4]]){
    waitForClock(session.run,600);
    session.run('confirmEndHalf()');
    assert.equal(session.run('S.phase'),breakPhase);
    assert.match(session.view.innerHTML,/ON COURT · 4\/5/);
    const saved=JSON.parse(session.storage.get('squadmgr_v1'));
    // The break phase is sufficient to resume even if old quarter flags are missing.
    delete saved.q1BreakDone;
    delete saved.q3BreakDone;
    session.storage.set('squadmgr_v1',JSON.stringify(saved));
    session=app(session.storage);
    session.run('continueGame()');
    clickLineupStart(session,`START Q${nextQuarter} WITH 4`);
    assert.equal(session.run('getCurrentQuarter()'),`Q${nextQuarter}`);
    assert.equal(session.run('getPeriodRemaining()'),600);
    assert.equal(session.run('S.isClockRunning'),true);
    waitForClock(session.run,1);
    assert.equal(session.run('getPeriodRemaining()'),599);
    assert.deepEqual(session.data(onCourt),[1,2,3,4]);
  }
});

test('a break still requires a nonempty lineup; an eligible bench player can fill it', () => {
  const session=app();
  const {run,view}=session;
  run(`${leagueCode}; ${rosterCode}; startGame(); ${setLineup}; finishLineup(); endHalf();
    for(let id=0;id<5;id++) toggleLineupPlayer(id)`);
  assert.match(view.innerHTML,/Select 1 more player/);
  assert.match(view.innerHTML,/onclick="finishLineup\(\)" disabled/);
  run('finishLineup()');
  assert.equal(run('S.phase'),'q1break');
  run('for(const id of [0,1,2,3,5]) toggleLineupPlayer(id)');
  clickLineupStart(session,'START Q2');
  assert.deepEqual(session.data(onCourt),[0,1,2,3,5]);
});

test('an iPad install prompt cannot cover the game or period-start button', () => {
  const {run,mounted,timers}=app();
  const banner=mounted.get('install-banner');
  run("navigator.userAgent='iPad'; maybeShowBanner(); maybeShowBanner()");
  const [prompt,latePrompt]=timers.filter(timer=>timer.delay===2500);
  prompt.callback();
  assert.equal(banner.style.display,'block');
  run(`${leagueCode}; ${rosterCode}; startGame(); ${setLineup}; finishLineup(); endHalf()`);
  latePrompt.callback();
  assert.equal(banner.style.display,'none');
});

test('timeouts move players immediately on screen and log changes only on Resume', () => {
  const {run, data, view} = app();
  run(`${leagueCode}; ${rosterCode}; startGame(); ${setLineup}; finishLineup(); togglePause()`);
  assert.match(view.innerHTML, /TIMEOUT/);
  assert.match(view.innerHTML, /RESUME GAME/);
  assert.equal(run('S.isClockRunning'), false);
  run('toggleLineupPlayer(1); toggleLineupPlayer(5)');
  assert.deepEqual(data('[...lineupCourt()]'), [0, 2, 3, 4, 5]);
  assert.deepEqual(data(onCourt), [0, 1, 2, 3, 4]);
  assert.equal(run('S.subLog.length'), 0);
  run('finishLineup()');
  assert.deepEqual(data('S.subLog[0].off'), ['Bea']);
  assert.deepEqual(data('S.subLog[0].on'), ['Fran']);
  run('undoLastSub()');
  assert.deepEqual(data(onCourt), [0, 1, 2, 3, 4]);
});

test('half format keeps its running-clock timeout rule and existing second-half preset', () => {
  const {run, data, view} = app();
  run(`${rosterCode}; S.h2Dur=16; S.useH2Preset=true; S.h2PresetIds=new Set([1,2,3,4,5]); startGame(); ${setLineup}; finishLineup(); togglePause()`);
  assert.equal(run('S.isClockRunning'), true);
  waitForClock(run, 10);
  assert.equal(run('S.gameTime'), 10);
  assert.equal(run('S.players[0].playTime'), 0);
  run('finishLineup(); endHalf()');
  assert.match(view.innerHTML, /START 2ND HALF/);
  assert.deepEqual(data('[...lineupCourt()]'), [1, 2, 3, 4, 5]);
  run('toggleLineupPlayer(5); toggleLineupPlayer(6); finishLineup()');
  assert.equal(run('getPeriodRemaining()'), 960);
  assert.deepEqual(data(onCourt), [1, 2, 3, 4, 6]);
});

test('restores an existing live game and keeps saved teams, plans, and reports', () => {
  const players = roster.map((name, id) => ({id, name, onCourt: id < 5, fouls: 0,
    playTime: id < 5 ? 87 : 0, h1PlayTime: id < 5 ? 87 : 0, h2PlayTime: 0, benchTime: 0, benchStint: 0}));
  const oldGame = {phase:'h1', names:roster, players, gameTime:87, halfTime:87,
    h1Int:180, h2Int:180, subCountdown:93, subPlan:{h1:[{on:[6],off:[0],atTime:'4:00'}],h2:[]}};
  const plans = [{id:'p',name:'Existing',players:roster,h1Dur:20,h2Dur:20,subPlan:oldGame.subPlan}];
  const saved = new Map([
    ['squadmgr_v1', JSON.stringify(oldGame)],
    ['squadmgr_teams_v1', '[{"id":"old","club":"Old Team","players":[]}]'],
    ['squadmgr_reports_v1', '[{"teamName":"Old Team"}]'],
    ['squadmgr_plans_v1', JSON.stringify(plans)],
  ]);
  const {run, data, view} = app(saved);
  assert.match(view.innerHTML, /CONTINUE GAME/);
  run('saveState(); continueGame()');
  assert.match(view.innerHTML, /RESUME GAME/);
  assert.deepEqual(data('[...lineupCourt()]'), [0, 1, 2, 3, 4]);
  assert.equal(run('S.gameTime'), 87);
  assert.equal(run('S.isRunning'), false);
  assert.equal(run('S.subPlan.h1[0].atTime'), '4:00');
  assert.equal(run('P.plans[0].subPlan.h1[0].atTime'), '4:00');
  assert.equal(saved.get('squadmgr_teams_v1'), '[{"id":"old","club":"Old Team","players":[]}]');
  assert.equal(saved.get('squadmgr_reports_v1'), '[{"teamName":"Old Team"}]');
});

test('quarter-break lineup and 20-second sub interval survive reopening', () => {
  const {run, storage} = app();
  run(`${leagueCode}; saveTeams(); localStorage.setItem(TEAMS_KEY+'_active','team'); ${rosterCode}; S.h1Int=20;
    startGame(); ${setLineup}; finishLineup(); endHalf(); toggleLineupPlayer(0); toggleLineupPlayer(6)`);
  const restored = app(storage);
  restored.run('continueGame()');
  assert.match(restored.view.innerHTML, /START Q2/);
  assert.deepEqual(restored.data('[...lineupCourt()]'), [1, 2, 3, 4, 6]);
  restored.run('finishLineup()');
  assert.equal(restored.run('getPeriodRemaining()'), 600);
  assert.equal(restored.run('getSubInt()'), 20);
});

test('automatic layout follows orientation and manual layout survives reload', async () => {
  const {run, storage, root, wide} = app();
  assert.equal(root.dataset.layout, 'portrait');
  wide.matches = true;
  wide.change();
  assert.equal(root.dataset.layout, 'landscape');
  await run("setLayout('portrait')");
  assert.equal(root.dataset.layout, 'portrait');
  assert.equal(app(storage).root.dataset.layout, 'portrait');
  await run("setLayout('auto')");
  assert.equal(root.dataset.layout, 'landscape');
  assert.equal(run('APP_VERSION'), version);
  assert.equal(run('typeof generateAIRotation'), 'undefined');
  assert.equal(run('typeof exportSubPlan'), 'function');
});

test('offline worker refreshes only the app shell and serves its cached copy without a network', async () => {
  const listeners = {};
  const responses = new Map();
  const cache = {
    async add(request) { responses.set(request.url, new Response('initial app')); },
    async put(url, response) { responses.set(String(url), response); },
  };
  let offline = false;
  let fetchCount = 0;
  const scope = 'https://example.test/squadmanager/';
  vm.runInNewContext(readFileSync(join(__dirname, '../sw.js'), 'utf8'), {
    URL, Request, Response,
    self: {registration:{scope}, addEventListener: (name, callback) => { listeners[name] = callback; }},
    caches: {open: async () => cache, match: async url => responses.get(String(url))?.clone()},
    fetch: async () => {
      fetchCount++;
      if (offline) throw new Error('Network down');
      return new Response('updated app');
    },
  });
  let install;
  listeners.install({waitUntil: task => { install = task; }});
  await install;
  function request(url, mode='navigate') {
    let result;
    listeners.fetch({request:{url, mode, method:'GET'}, respondWith: task => { result = task; }});
    return result;
  }
  assert.equal(request(scope+'version.txt', 'cors'), undefined);
  assert.equal(request('https://example.test/unrelated/'), undefined);
  assert.equal(fetchCount, 0);
  assert.equal(await (await request(scope+'?t=123')).text(), 'updated app');
  offline = true;
  assert.equal(await (await request(scope+'index.html')).text(), 'updated app');
});

test('US scoring is assigned by tapping an on-court name and keeps the first-tap clock', () => {
  const {run, data, view, mounted} = app();
  run(`${leagueCode}; ${rosterCode}; startGame(); ${setLineup}; finishLineup(); toggleScoreBar()`);
  assert.equal(run("(renderScoreBarHTML().match(/class=\"score-stat-btn\"/g)||[]).length"),10);
  assert.match(run('renderScoreBarHTML()'),/aria-label="Shot Clock Violation"[^>]*>.*class="stat-short">Shot Clock<\/span>/);
  assert.match(run('renderScoreBarHTML()'),/armPlayerEvent\('points',1\)/);
  assert.match(view.innerHTML,/class="court-name"[^>]+tapCourtName\(0\)[^>]+>Ada<\/button>/);
  assert.doesNotMatch(view.innerHTML,/tapCourtName\(5\)/);
  waitForClock(run, 7);
  run("armPlayerEvent('points',2)");
  assert.match(run('renderScoreBarHTML()'),/Tap an on-court name/);
  assert.equal(mounted.has('stat-picker'),false);
  run("tapCourtName(5); togglePlayerSel(5,'bench'); togglePlayerSel(0,'court')");
  assert.equal(run('calcScoreTotals().us'),0);
  assert.equal(run('S.selBench.size+S.selCourt.size'),0);
  waitForClock(run, 3);
  run('tapCourtName(0)');
  assert.deepEqual(data('S.scoreLog[0]'),{t:7,period:'Q1',remaining:593,order:1,who:'us',pts:2,pid:0});
  run('tapCourtName(0)');
  assert.equal(run('S.selCourt.has(0)'),true);
  run("armPlayerEvent('points',3); cancelPlayerEvent()");
  assert.equal(run('calcScoreTotals().us'),2);
  run("armPlayerEvent('points',1); assignPlayerEvent()");
  run("addScoreEvent('them',3)");
  assert.deepEqual(data('calcScoreTotals()'),{us:3,them:3});
  assert.equal(run('S.scoreLog[1].pid'),undefined);
});

test('all nine individual stats can be credited and undone without touching fouls', () => {
  const {run, data} = app();
  run(`${rosterCode}; startGame(); ${setLineup}; finishLineup(); addScoreEvent('us',3,0)`);
  for(const kind of data("PLAYER_STATS.map(row=>row[0]).filter(kind=>kind!=='shotclock')")){
    run(`armPlayerEvent('${kind}'); tapCourtName(0)`);
  }
  run('toggleFoul(0,0)');
  assert.equal(run('S.statLog.length'),10);
  run('undoTrackedEvent()');
  assert.equal(run('S.statLog.some(e=>e.kind==="missft")'),false);
  assert.equal(run('S.players[0].fouls'),1);
  run("addScoreEvent('us',2,0); undoTrackedEvent()");
  assert.equal(run('calcScoreTotals().us'),3);
  run('toggleFoul(0,0)');
  assert.equal(run('S.statLog.some(e=>e.kind==="foul")'),false);
});

test('shot clock violations record the current lineup once and undo as a group after reopening', () => {
  const first=app();
  first.run(`${leagueCode}; saveTeams(); localStorage.setItem(TEAMS_KEY+'_active','team'); ${rosterCode}; startGame(); ${setLineup}; finishLineup()`);
  waitForClock(first.run,8);
  first.run("armPlayerEvent('assist'); armPlayerEvent('shotclock')");
  assert.equal(first.run('pendingPlayerEvent'),null);
  assert.deepEqual(first.data('S.statLog[0]'),{t:8,period:'Q1',remaining:592,order:1,kind:'shotclock',pids:[0,1,2,3,4]});
  first.run("togglePlayerSel(0,'court'); togglePlayerSel(5,'bench'); commitSub(); armPlayerEvent('shotclock')");
  const restored=app(first.storage);
  const {run,data}=restored;
  run('continueGame(); finishLineup()');
  const violations='eventSummaryRows(S.players,S.scoreLog,S.statLog).map(row=>row[12])';
  assert.deepEqual(data(violations),[1,2,2,2,2,1,0]);
  const txt=run('eventReportText(S.players,S.scoreLog,S.statLog)');
  assert.match(txt,/0:08\tQ1\t9:52\tAda, Bea, Cora, Di, Ella\tShot Clock Violation\t1/);
  assert.equal(txt.split('\n').filter(line=>line.endsWith('\tShot Clock Violation\t1')).length,2);
  run('undoTrackedEvent()');
  assert.deepEqual(data(violations),[1,1,1,1,1,0,0]);
});

test('the exact stats matrix survives reopening and reaches the summary, PDF and AI report', () => {
  const first=app();
  first.run(`${rosterCode}; startGame(); ${setLineup}; finishLineup(); addScoreEvent('us',2,0); addScoreEvent('us',3,0)`);
  waitForClock(first.run,8);
  first.run("armPlayerEvent('assist'); tapCourtName(0); armPlayerEvent('missft'); tapCourtName(0)");
  first.run('toggleFoul(0,0)');
  const {run, data, storage, view, mounted}=app(first.storage);
  run('continueGame(); finishLineup(); endGame(); saveGameReport()');
  const columns=['Name','Points','Fouls','Assists','Offensive Rebound','Steal','Defensive Rebound',
    'Missed Shot','Missed Foul Shot','Turnover Pass','Turnover Steal','Turnover Travel','Shot Clock Violation'];
  assert.deepEqual(data('eventSummaryHeaders()'),columns);
  const adaRow=/<th scope="row">Ada<\/th><td>5<\/td><td>1<\/td><td>1<\/td><td>0<\/td><td>0<\/td><td>0<\/td><td>0<\/td><td>1<\/td>/;
  assert.match(view.innerHTML,adaRow);
  const saved=JSON.parse(storage.get('squadmgr_reports_v1'))[0];
  assert.equal(saved.scoreLog[0].pid,0);
  assert.equal(saved.statLog.length,3);
  run('exportGamePDF()');
  const printHtml=mounted.get('pdf-preview-modal').children[1].contentDocument.html;
  assert.match(printHtml,adaRow);
  assert.equal((printHtml.match(/class="page(?: page-details)?"/g)||[]).length,2);
  assert.doesNotMatch(printHtml,/<table class="report-sub-log">/);
  run('uploadToClaudeModal()');
  const modal=mounted.get('claude-report-modal');
  const txt=modal.children.find(el=>el.tag==='textarea').value;
  assert.match(txt,/0:08\tH1\t19:52\tAda\tAssist\t1/);
  assert.match(txt,/0:08\tH1\t19:52\tAda\tFoul\t1/);
  assert.ok(txt.includes(columns.join('\t')));
  assert.match(txt,/Ada\t5\t1\t1\t0\t0\t0\t0\t1\t0\t0\t0\t0/);
  assert.match(txt,/0:08\tH1\t19:52\tAda\tMissed Foul Shot\t1/);
  assert.equal(modal.children[0].children.some(button=>button.textContent==='Download TXT'),true);
  run('viewSavedReport(0)');
  const report=mounted.get('saved-report-modal');
  assert.match(report.children[2].children[1].innerHTML,adaRow);
  report.children[1].children[1].onclick();
  const savedTxt=mounted.get('saved-ai-export').children.find(el=>el.tag==='textarea').value;
  assert.match(savedTxt,/0:08\tH1\t19:52\tAda\tAssist\t1/);
});

test('the A4 export keeps the overview first and flows the complete sub log and stats together', () => {
  const {run,mounted}=app();
  run(`${rosterCode}; startGame(); ${setLineup}; finishLineup(); addScoreEvent('us',2,0);
    S.subLog=Array.from({length:65},(_,i)=>({gameTime:20+i*30,halfTime:20+i*30,half:1,
      isHalftime:i===32,on:[i===64?'Final <Sub>':'Fran'],off:['Ada']}));
    endGame(); exportGamePDF()`);
  const printHtml=mounted.get('pdf-preview-modal').children[1].contentDocument.html;
  assert.match(printHtml,/@page\{size:A4 portrait;margin:12\.5mm\}/);
  assert.match(printHtml,/\.page\{width:auto!important;min-height:0!important;padding:0!important\}/);
  assert.equal((printHtml.match(/class="page(?: page-details)?"/g)||[]).length,2);
  const [overview,details]=printHtml.split('<div class="page page-details"');
  assert.match(overview,/Score Differential/);
  assert.match(overview,/Rotation Timeline/);
  assert.match(overview,/Player Statistics/);
  assert.doesNotMatch(overview,/<table class="report-sub-log">/);
  assert.match(details,/<table class="report-sub-log">[\s\S]*?<caption>Substitution Log · 65 entries<\/caption>/);
  assert.match(details,/class="sub-halftime"/);
  assert.match(details,/Final &lt;Sub&gt;[\s\S]*<caption>Player Events<\/caption>/);
  assert.doesNotMatch(details,/min-height:1123px/);
});

test('reopening Full Time at XL text size keeps the export actions separate from the scrolling report', () => {
  const first=app();
  first.run(`${rosterCode}; CFG.uiScale=1.3; saveSettings();
    startGame(); ${setLineup}; finishLineup(); addScoreEvent('us',2,0); endGame()`);
  const {run,view,root,storage}=app(first.storage);
  assert.equal(run('S.phase'),'gameover');
  assert.equal(root.style['--ui-scale'],'1.3');
  assert.match(view.innerHTML,/<div class="go viewport-frame">\s*<div class="go-scroll">/);
  const footer=view.innerHTML.match(/<\/div>\s*<\/div>\s*<footer class="go-footer">([\s\S]*?)<\/footer>/)?.[1];
  assert.ok(footer);
  const actions=[...footer.matchAll(/onclick="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(actions,['exportReport()','exportGamePDF()','saveGameReport()','uploadToClaudeModal()','newGame()']);
  run(actions[2]);
  assert.equal(JSON.parse(storage.get('squadmgr_reports_v1'))[0].score.us,2);
});

test('switching actions replaces the selection; a timeout clears it without recording', () => {
  const {run, data}=app();
  run(`${rosterCode}; startGame(); ${setLineup}; finishLineup(); armPlayerEvent('assist'); armPlayerEvent('dreb'); tapCourtName(0)`);
  assert.deepEqual(data('S.statLog.map(e=>e.kind)'),['dreb']);
  run("armPlayerEvent('points',3); togglePause(); finishLineup(); tapCourtName(1)");
  assert.equal(run('S.scoreLog.length'),0);
  assert.equal(run('S.selCourt.has(1)'),true);
});

test('old team scores and foul totals are retained without invented attribution or timestamps', () => {
  const {run, data}=app();
  const args="[{id:0,name:'Ada',fouls:2}],[{t:17,who:'us',pts:2}],[]";
  assert.deepEqual(data(`eventSummaryRows(${args})`),[
    ['Ada',0,2,...Array(10).fill(0)],['Unassigned',2,0,...Array(10).fill(0)],
  ]);
  const txt=run(`eventReportText(${args})`);
  assert.match(txt,/0:17\t\t\tUnassigned \(US\)\tPoints\t2/);
  assert.match(txt,/without a timestamp/);
});
