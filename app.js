(() => {
  "use strict";
  const STORAGE_KEY = "rally-pickleball-organizer-v1";
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const uid = () => (window.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const initials = name => (name || "?").trim().split(/\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase();
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const winRate = p => p.games ? Math.round(p.wins / p.games * 100) : 0;
  const nowISO = () => new Date().toISOString();
  const fmtDate = value => new Date(value).toLocaleString([], {month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
  const freshState = () => ({players:[], history:[], activeMatch:null, settings:{theme:"light",mode:"doubles",court:"Court 1",duration:15,strategy:"balanced",target:11}, lastMatchId:null});
  let state = loadState();
  let rosterFilter = "all", toastTimer, timerInterval = null, confirmCallback = null;
  let draftTeams = {A:[],B:[]};
  let timer = {remaining: (state.settings.duration || 15)*60, initial:(state.settings.duration || 15)*60, running:false, deadline:null};
  function loadState(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      const s = {...freshState(), ...JSON.parse(raw)};
      s.players = Array.isArray(s.players) ? s.players : [];
      s.history = Array.isArray(s.history) ? s.history : [];
      s.settings = {...freshState().settings, ...(s.settings || {})};
      return s;
    } catch { return freshState(); }
  }
  function save(){ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { showToast("Could not save locally. Check your browser storage settings."); } }
  function showToast(message){
    const el=$("#toast"); el.textContent=message; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2600);
  }
  function navigate(page){
    $$(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${page}`));
    $$(".nav-tab").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    window.scrollTo({top:0,behavior:"smooth"});
    if(page==="players") renderPlayers();
    if(page==="setup") renderSetup();
    if(page==="active") renderActive();
    if(page==="history") renderHistory();
    if(page==="stats") renderStats();
  }
  function activePlayers(){ return state.players.filter(p=>p.status==="active" || p.status==="bench"); }
  function eligiblePlayers(){ return state.players.filter(p=>p.status==="active"); }
  function playerById(id){ return state.players.find(p=>p.id===id); }
  function displayPlayer(id){ return playerById(id)?.name || "Unassigned"; }
  function updateHeader(){
    $("#heroPlayers").textContent=eligiblePlayers().length;
    $("#heroMatches").textContent=state.history.length;
    $("#activeNavDot").classList.toggle("hidden",!state.activeMatch);
  }
  function renderPlayers(){
    const query=$("#playerSearch").value.trim().toLowerCase();
    const filtered=state.players.filter(p=>{
      const matches=(p.name+" "+(p.nickname||"")).toLowerCase().includes(query);
      const status=rosterFilter==="all" || (rosterFilter==="active"&&p.status==="active") || (rosterFilter==="bench"&&p.status==="bench");
      return matches&&status;
    });
    $("#playerGrid").innerHTML=filtered.map(p=>`
      <article class="player-card glass">
        <div class="player-card-top"><div class="avatar">${escapeHTML(initials(p.name))}</div><div class="player-ident"><h3>${escapeHTML(p.name)}</h3><p>${escapeHTML(p.nickname || "Rally player")}</p></div>
        <select class="status-select" data-status-player="${p.id}" aria-label="Availability for ${escapeHTML(p.name)}"><option value="active" ${p.status==="active"?"selected":""}>Active</option><option value="bench" ${p.status==="bench"?"selected":""}>On Bench</option><option value="inactive" ${p.status==="inactive"?"selected":""}>Inactive</option></select></div>
        <div class="player-mini-stats"><div class="mini-stat"><span>Games</span><strong>${p.games||0}</strong></div><div class="mini-stat"><span>Wins</span><strong>${p.wins||0}</strong></div><div class="mini-stat"><span>Win rate</span><strong class="rate">${winRate(p)}%</strong></div></div>
        <div class="player-card-footer"><div class="win-track"><span style="width:${winRate(p)}%"></span></div><div class="tiny-actions"><button data-edit-player="${p.id}" title="Edit player" aria-label="Edit ${escapeHTML(p.name)}">✎</button><button data-delete-player="${p.id}" title="Delete player" aria-label="Delete ${escapeHTML(p.name)}">×</button></div></div>
      </article>`).join("");
    $("#emptyPlayers").classList.toggle("hidden",state.players.length>0);
    $("#playerGrid").classList.toggle("hidden",filtered.length===0);
    if(state.players.length && !filtered.length) $("#playerGrid").innerHTML='<div class="empty-state glass" style="grid-column:1/-1"><h3>No players found</h3><p>Try a different search or filter.</p></div>',$("#playerGrid").classList.remove("hidden");
    updateHeader();
  }
  function openPlayerDialog(id=null){
    $("#playerForm").reset(); $("#playerId").value=id||"";
    const p=id?playerById(id):null;
    $("#playerDialogTitle").textContent=p?"Edit player":"Add player";
    $("#playerName").value=p?.name||""; $("#playerNickname").value=p?.nickname||"";
    $("#playerStatus").value=p?.status||"active";
    $("#playerDialog").showModal(); $("#playerName").focus();
  }
  function savePlayer(e){
    e.preventDefault();
    const id=$("#playerId").value, name=$("#playerName").value.trim();
    if(!name) return;
    const nickname=$("#playerNickname").value.trim(), status=$("#playerStatus").value;
    if(id){ const p=playerById(id); if(p){p.name=name;p.nickname=nickname;p.status=status;} }
    else state.players.push({id:uid(),name,nickname,status,games:0,wins:0,losses:0,points:0});
    save(); $("#playerDialog").close(); renderPlayers(); renderSetup(); renderStats();
    showToast(id?"Player updated":"Player added to your roster");
  }
  function deletePlayer(id){
    const p=playerById(id); if(!p)return;
    askConfirm("Remove player?",`Remove ${p.name} from the roster? Their recorded match history stays intact, but future matches will no longer include them.`,()=>{
      state.players=state.players.filter(x=>x.id!==id);
      if(state.activeMatch && [...state.activeMatch.teams.A,...state.activeMatch.teams.B].includes(id)){
        state.activeMatch=null; stopTimer(); timer.running=false;
      }
      draftTeams.A=draftTeams.A.filter(x=>x!==id); draftTeams.B=draftTeams.B.filter(x=>x!==id);
      save(); renderPlayers(); renderSetup(); renderActive(); renderHistory(); renderStats(); showToast("Player removed");
    });
  }
  function askConfirm(title,message,callback){
    $("#confirmTitle").textContent=title; $("#confirmMessage").textContent=message;
    confirmCallback=callback; $("#confirmDialog").showModal();
  }
  function runConfirm(){ const fn=confirmCallback; confirmCallback=null; $("#confirmDialog").close(); if(fn)fn(); }
  function modeCount(){return state.settings.mode==="singles"?1:2;}
  function shuffle(list){const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  function generateTeams(){
    const count=modeCount(), eligible=eligiblePlayers();
    if(eligible.length<count*2){showToast(`You need at least ${count*2} active players for this format.`);return false;}
    let pool=shuffle(eligible);
    if(state.settings.strategy==="balanced"){
      pool.sort((a,b)=>winRate(b)-winRate(a));
      const best=pool.slice(0,count*2);
      let bestTeams=null,bestDiff=Infinity;
      // Try permutations of the available lineup, balancing combined career win rates.
      for(let i=0;i<160;i++){
        const candidate=shuffle(best);
        const A=candidate.slice(0,count),B=candidate.slice(count,count*2);
        const rA=A.reduce((s,p)=>s+winRate(p),0)/count, rB=B.reduce((s,p)=>s+winRate(p),0)/count;
        const diff=Math.abs(rA-rB);
        if(diff<bestDiff){bestDiff=diff;bestTeams={A:A.map(p=>p.id),B:B.map(p=>p.id)};}
        if(diff===0)break;
      }
      draftTeams=bestTeams;
    }else{
      pool=shuffle(pool).slice(0,count*2);
      draftTeams={A:pool.slice(0,count).map(p=>p.id),B:pool.slice(count,count*2).map(p=>p.id)};
    }
    renderSetup(); showToast("Matchup generated. You can still edit each player.");
    return true;
  }
  function renderSetup(){
    $$("#modePicker button").forEach(b=>b.classList.toggle("selected",b.dataset.mode===state.settings.mode));
    $("#courtSelect").value=state.settings.court; $("#durationSelect").value=String(state.settings.duration);
    $$('input[name="strategy"]').forEach(r=>{r.checked=r.value===state.settings.strategy;r.closest(".strategy").classList.toggle("selected",r.checked);});
    const count=modeCount();
    ["A","B"].forEach(team=>{
      const ids=draftTeams[team]||[];
      const container=team==="A"?$("#teamASlots"):$("#teamBSlots");
      container.innerHTML=Array.from({length:count},(_,i)=>{
        const options=eligiblePlayers().map(p=>`<option value="${p.id}" ${ids[i]===p.id?"selected":""}>${escapeHTML(p.name)}</option>`).join("");
        return `<div class="player-slot"><select data-team="${team}" data-slot="${i}" aria-label="Team ${team} player ${i+1}"><option value="">Choose player…</option>${options}</select></div>`;
      }).join("");
      const players=ids.map(playerById).filter(Boolean);
      $(`#rating${team}`).textContent=players.length===count?`${Math.round(players.reduce((s,p)=>s+winRate(p),0)/count)}%`:"—";
    });
    const selected=[...draftTeams.A,...draftTeams.B].filter(Boolean);
    const dup=new Set(selected).size!==selected.length;
    $("#setupNote").textContent=dup?"A player is assigned more than once. Choose different players.":selected.length===count*2?"Lineup ready. Make any changes before starting.":"Generate a matchup or choose players manually.";
    $("#startMatchBtn").disabled=dup||selected.length!==count*2||selected.some(id=>!playerById(id)||playerById(id).status!=="active");
    $("#startMatchBtn").style.opacity=$("#startMatchBtn").disabled?".5":"1";
    updateHeader();
  }
  function startMatch(){
    const count=modeCount(), ids=[...draftTeams.A,...draftTeams.B];
    if(ids.length!==count*2||ids.some(id=>!playerById(id))||new Set(ids).size!==ids.length){showToast("Please assign a unique active player to every slot.");return;}
    if(ids.some(id=>playerById(id).status!=="active")){showToast("Only active players can start a match.");return;}
    if(state.activeMatch) { askConfirm("Replace active match?","Starting this match will discard the current unfinished game.",()=>{state.activeMatch=null;beginMatch();});return; }
    beginMatch();
  }
  function beginMatch(){
    const duration=Number(state.settings.duration)||15;
    state.activeMatch={id:uid(),startedAt:nowISO(),mode:state.settings.mode,court:state.settings.court,duration,target:state.settings.target||11,teams:{A:[...draftTeams.A],B:[...draftTeams.B]},score:{A:0,B:0},switched:false,timerRemaining:duration*60,timerRunning:false,timerDeadline:null};
    timer={remaining:duration*60,initial:duration*60,running:false,deadline:null};
    save(); renderActive(); navigate("active"); showToast("Match started. Have a great game!");
  }
  function stopTimer(){if(timerInterval){clearInterval(timerInterval);timerInterval=null;}}
  function currentMatch(){return state.activeMatch;}
  function syncTimerToState(){const m=currentMatch();if(!m)return;m.timerRemaining=timer.remaining;m.timerRunning=timer.running;m.timerDeadline=timer.deadline;}
  function hydrateTimer(){
    const m=currentMatch();
    if(!m){timer={remaining:(state.settings.duration||15)*60,initial:(state.settings.duration||15)*60,running:false,deadline:null};return;}
    timer.initial=(m.duration||15)*60;
    timer.running=!!m.timerRunning;
    timer.deadline=m.timerDeadline||null;
    timer.remaining=timer.running&&timer.deadline?Math.max(0,Math.ceil((new Date(timer.deadline).getTime()-Date.now())/1000)):Math.max(0,Number(m.timerRemaining??timer.initial));
    if(timer.running && timer.remaining===0){timer.running=false;timer.deadline=null;m.timerRunning=false;m.timerDeadline=null;m.timerRemaining=0;save();showToast("Time is up!");}
    if(timer.running) startTicker();
  }
  function startTicker(){
    stopTimer();
    timerInterval=setInterval(()=>{
      if(!timer.running)return;
      timer.remaining=Math.max(0,Math.ceil((new Date(timer.deadline).getTime()-Date.now())/1000));
      if(timer.remaining<=0){timer.remaining=0;timer.running=false;timer.deadline=null;stopTimer();showToast("⏱ Time is up!");}
      syncTimerToState();save();updateTimerDisplay();
    },250);
  }
  function updateTimerDisplay(){
    const m=currentMatch();
    const seconds=Math.max(0,timer.remaining),mins=Math.floor(seconds/60),secs=seconds%60;
    $("#timerDisplay").textContent=`${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
    $("#timerCaption").textContent=seconds===0?"TIME IS UP":"MINUTES LEFT";
    $("#timerRing").style.background=`conic-gradient(${seconds===0?"var(--red)":"var(--blue)"} ${timer.initial?100*seconds/timer.initial:0}%,rgba(130,144,180,.13) 0)`;
    $("#timerStartBtn").textContent=timer.running?"Ⅱ Pause":"▶ Start";
    $("#timerHint").textContent=seconds===0?"Time is up. Finish the match or add time.":timer.running?"Clock is running. Keep the rally going.":"Timer is paused.";
    $$(".timer-presets button").forEach(b=>b.classList.toggle("selected",Number(b.dataset.minutes)*60===timer.initial));
    if(m) {m.timerRemaining=timer.remaining;m.timerRunning=timer.running;m.timerDeadline=timer.deadline;}
  }
  function setDuration(minutes){
    state.settings.duration=minutes;
    if(currentMatch()){
      timer.running=false;stopTimer();timer.initial=minutes*60;timer.remaining=minutes*60;timer.deadline=null;
      currentMatch().duration=minutes;syncTimerToState();
    }else{timer.initial=minutes*60;timer.remaining=minutes*60;}
    save();renderActive();showToast(`Timer set to ${minutes} minutes.`);
  }
  function toggleTimer(){
    if(!currentMatch()){showToast("Start a match before using the timer.");return;}
    if(timer.running){timer.running=false;timer.deadline=null;stopTimer();syncTimerToState();save();updateTimerDisplay();return;}
    if(timer.remaining<=0){showToast("Reset the timer or add a minute first.");return;}
    timer.running=true;timer.deadline=new Date(Date.now()+timer.remaining*1000).toISOString();syncTimerToState();save();startTicker();updateTimerDisplay();
  }
  function resetTimer(){
    timer.running=false;stopTimer();timer.deadline=null;timer.remaining=timer.initial;syncTimerToState();save();updateTimerDisplay();
  }
  function addMinute(){
    timer.remaining+=60;if(!timer.running)timer.initial=Math.max(timer.initial,timer.remaining);
    if(timer.running)timer.deadline=new Date(Date.now()+timer.remaining*1000).toISOString();
    syncTimerToState();save();updateTimerDisplay();showToast("Added one minute to the clock.");
  }
  function renderActive(){
    const m=currentMatch();
    $("#noActiveGame").classList.toggle("hidden",!!m);
    $$(".live-layout,#page-active>.active-footer").forEach(el=>el.classList.toggle("hidden",!m));
    if(!m){$("#gameStatus").innerHTML="<i></i> Ready to play";$("#gameStatus").className="pill neutral";updateTimerDisplay();return;}
    $("#gameStatus").innerHTML="<i></i> Match in progress";$("#gameStatus").className="pill live-pill";
    $("#liveCourt").textContent=m.court.toUpperCase();
    $("#liveMode").textContent=m.mode==="singles"?"SINGLES · 1V1":"DOUBLES · 2V2";
    const a=m.teams.A.map(displayPlayer),b=m.teams.B.map(displayPlayer);
    $("#liveNamesA").textContent=a.join(" & ");$("#liveNamesB").textContent=b.join(" & ");
    $("#scoreA").textContent=m.score.A;$("#scoreB").textContent=m.score.B;$("#targetLabel").textContent=m.target||11;
    const target=m.target||11, s=m.score;
    const gamePoint=(s.A>=target-1&&s.A>s.B)||(s.B>=target-1&&s.B>s.A)||(s.A>=target&&s.A-s.B===1)||(s.B>=target&&s.B-s.A===1);
    $("#gamePointBanner").classList.toggle("hidden",!gamePoint);
    $("#gamePointBanner").textContent=gamePoint?"★ GAME POINT":"";
    $("#switchSidesBtn").textContent=m.switched?"⇄ Switch sides (switched)":"⇄ Switch sides";
    hydrateTimer();updateTimerDisplay();updateHeader();
  }
  function changeScore(team,delta){
    const m=currentMatch();if(!m){showToast("Start a match before tracking points.");return;}
    const before=m.score[team];m.score[team]=Math.max(0,before+delta);
    if(m.score[team]!==before){
      save();renderActive();
      const other=team==="A"?"B":"A";
      if(m.score[team]>=m.target&&m.score[team]-m.score[other]>=2)showToast(`Team ${team} has reached a winning score. Finish the match to record it.`);
      else if(m.score[team]>=m.target-1&&m.score[team]>m.score[other])showToast(`Game point for Team ${team}!`);
    }
  }
  function finishMatch(){
    const m=currentMatch();if(!m){showToast("There is no active match to finish.");return;}
    if(m.score.A===m.score.B){showToast("The score is tied. Add a point to decide the winner.");return;}
    if(Math.max(m.score.A,m.score.B)<m.target || Math.abs(m.score.A-m.score.B)<2){
      askConfirm("Finish before match point?",`The score is ${m.score.A}–${m.score.B}. This does not meet the first-to-${m.target}, win-by-2 rule. Record this result anyway?`,()=>recordMatch(m));return;
    }
    recordMatch(m);
  }
  function recordMatch(m){
    stopTimer();timer.running=false;
    const winner=m.score.A>m.score.B?"A":"B", loser=winner==="A"?"B":"A";
    const teamIds=[...m.teams.A,...m.teams.B];
    const record={...JSON.parse(JSON.stringify(m)),finishedAt:nowISO(),winner,mvp:null};
    // MVP is the winning player with the most points credited to their team; use a fair tie-break shuffle.
    const winningIds=m.teams[winner].filter(id=>playerById(id));
    record.mvp=winningIds.length?winningIds[Math.floor(Math.random()*winningIds.length)]:null;
    teamIds.forEach(id=>{const p=playerById(id);if(!p)return;p.games=(p.games||0)+1;p.points=(p.points||0)+m.score[m.teams.A.includes(id)?"A":"B"];if(m.teams[winner].includes(id))p.wins=(p.wins||0)+1;else p.losses=(p.losses||0)+1;});
    state.history.unshift(record);state.lastMatchId=record.id;state.activeMatch=null;save();
    timer={remaining:(state.settings.duration||15)*60,initial:(state.settings.duration||15)*60,running:false,deadline:null};
    renderPlayers();renderHistory();renderStats();renderActive();updateHeader();navigate("history");showToast("Match result saved to history.");
  }
  function undoMatch(id){
    const m=state.history.find(x=>x.id===id);if(!m)return;
    askConfirm("Undo this result?","This removes the match from history and reverses the recorded games, wins, losses, and points for players still in your roster.",()=>{
      applyMatchStats(m,-1);state.history=state.history.filter(x=>x.id!==id);save();renderHistory();renderPlayers();renderStats();updateHeader();showToast("Match result undone.");
    });
  }
  function applyMatchStats(m,factor){
    const winner=m.winner, aIds=m.teams.A||[],bIds=m.teams.B||[];
    [...aIds,...bIds].forEach(id=>{
      const p=playerById(id);if(!p)return;
      p.games=Math.max(0,(p.games||0)+factor);
      const isWinner=(winner==="A"?aIds:bIds).includes(id);
      if(isWinner)p.wins=Math.max(0,(p.wins||0)+factor);else p.losses=Math.max(0,(p.losses||0)+factor);
      p.points=Math.max(0,(p.points||0)+factor*(m.score[id&&aIds.includes(id)?"A":"B"]||0));
    });
  }
  function renderHistory(){
    const h=state.history;
    $("#historySummary").innerHTML=[["Matches played",h.length],["Points scored",h.reduce((s,m)=>s+(m.score?.A||0)+(m.score?.B||0),0)],["Courts used",new Set(h.map(m=>m.court)).size]].map(([label,value])=>`<div class="summary-tile glass"><span>${label}</span><strong>${value}</strong></div>`).join("");
    $("#historyList").innerHTML=h.map(m=>{
      const winner=m.winner|| (m.score.A>m.score.B?"A":"B");
      const namesA=(m.teams.A||[]).map(displayPlayer),namesB=(m.teams.B||[]).map(displayPlayer);
      const teamLabel=(names,side)=>names.length?names.map(escapeHTML).join(" & "):`Team ${side}`;
      return `<article class="history-card glass"><div class="history-main"><div class="history-date">${escapeHTML(fmtDate(m.finishedAt||m.startedAt))} · ${escapeHTML(m.court||"Court")}</div><div class="history-matchup"><span class="${winner==="A"?"winner-name":""}">${teamLabel(namesA,"A")}</span><span class="muted">vs</span><span class="${winner==="B"?"winner-name":""}">${teamLabel(namesB,"B")}</span></div></div><div class="history-score">${m.score.A}<span>—</span>${m.score.B}</div><div class="history-meta">WINNER <b>Team ${winner}</b><br>MVP <b>${escapeHTML(displayPlayer(m.mvp))}</b></div><div class="history-actions"><button data-undo-match="${m.id}" title="Undo this match">↶ Undo</button><button data-delete-match="${m.id}" title="Delete this record">× Delete</button></div></article>`;
    }).join("");
    $("#emptyHistory").classList.toggle("hidden",h.length>0);
    $("#historyList").classList.toggle("hidden",h.length===0);
  }
  function renderStats(){
    const h=state.history, totalGames=state.players.reduce((s,p)=>s+(p.games||0),0),totalWins=state.players.reduce((s,p)=>s+(p.wins||0),0),points=state.players.reduce((s,p)=>s+(p.points||0),0);
    const overall=h.length?Math.round(h.filter(m=>m.winner).length/h.length*100):0;
    $("#statsOverview").innerHTML=[["Total matches",h.length],["Player wins",totalWins],["Points recorded",points]].map(([l,v])=>`<div class="overview-tile glass"><span>${l}</span><strong>${v}</strong></div>`).join("");
    const ranked=[...state.players].sort((a,b)=>winRate(b)-winRate(a)||(b.wins||0)-(a.wins||0)||(b.games||0)-(a.games||0));
    $("#leaderboard").innerHTML=ranked.length?ranked.map((p,i)=>`<div class="leader-row"><span class="rank">${String(i+1).padStart(2,"0")}</span><div class="leader-person"><div class="leader-avatar">${escapeHTML(initials(p.name))}</div><div><b>${escapeHTML(p.name)}</b><small>${p.wins||0} wins · ${p.losses||0} losses</small></div></div><span class="leader-rate">${winRate(p)}%</span><span class="leader-wins">${p.points||0} pts</span></div>`).join(""):'<p class="muted small">Add players to start your leaderboard.</p>';
    const recent=ranked.filter(p=>p.games>0).slice(0,6);
    $("#recentForm").innerHTML=recent.length?recent.map(p=>{
      const results=h.filter(m=>[...(m.teams.A||[]),...(m.teams.B||[])].includes(p.id)).slice(0,5).map(m=>m.winner===(m.teams.A||[]).includes(p.id)?"W":"L");
      while(results.length<5)results.push("—");
      return `<div class="form-row"><div><b>${escapeHTML(p.name)}</b><small>${p.games} games · ${winRate(p)}% win rate</small></div><div class="form-chips">${results.map(r=>`<span class="form-chip ${r==="W"?"win":r==="L"?"loss":"none"}">${r}</span>`).join("")}</div></div>`;
    }).join(""):'<p class="muted small">Finish a match to see recent form here.</p>';
    updateHeader();
  }
  function exportCSV(){
    const rows=[["Date","Court","Mode","Team A","Team B","Score A","Score B","Winner","MVP"]];
    state.history.forEach(m=>rows.push([m.finishedAt||m.startedAt,m.court,m.mode,(m.teams.A||[]).map(displayPlayer).join(" & "),(m.teams.B||[]).map(displayPlayer).join(" & "),m.score.A,m.score.B,m.winner,displayPlayer(m.mvp)]));
    const csv=rows.map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));const a=document.createElement("a");a.href=url;a.download="rally-match-history.csv";a.click();URL.revokeObjectURL(url);showToast("Match history exported.");
  }
  function resetAllStats(){
    askConfirm("Reset all player stats?","This clears all match history and player career totals. Your player roster will remain.",()=>{
      state.history=[];state.lastMatchId=null;state.players.forEach(p=>{p.games=0;p.wins=0;p.losses=0;p.points=0;});
      save();renderPlayers();renderHistory();renderStats();updateHeader();showToast("All player stats and history reset.");
    });
  }
  function deleteHistoryRecord(id){
    const m=state.history.find(x=>x.id===id);if(!m)return;
    askConfirm("Delete match record?","This permanently removes the history entry and reverses its career-stat changes.",()=>{applyMatchStats(m,-1);state.history=state.history.filter(x=>x.id!==id);save();renderHistory();renderPlayers();renderStats();updateHeader();showToast("Match record deleted.");});
  }
  function initTheme(){document.body.classList.toggle("dark",state.settings.theme==="dark");$("#themeToggle").textContent=state.settings.theme==="dark"?"☾":"☼";}
  // Events
  $$(".nav-tab").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
  $$("[data-goto]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.goto)));
  $("#addPlayerBtn").addEventListener("click",()=>openPlayerDialog());
  $("#emptyAddBtn").addEventListener("click",()=>openPlayerDialog());
  $("#playerForm").addEventListener("submit",savePlayer);
  $$("[data-close]").forEach(b=>b.addEventListener("click",()=>$( "#"+b.dataset.close).close()));
  $("#confirmAction").addEventListener("click",runConfirm);
  $("#playerSearch").addEventListener("input",renderPlayers);
  $$("#rosterFilter button").forEach(b=>b.addEventListener("click",()=>{rosterFilter=b.dataset.filter;$$("#rosterFilter button").forEach(x=>x.classList.toggle("selected",x===b));renderPlayers();}));
  $("#playerGrid").addEventListener("click",e=>{
    const edit=e.target.closest("[data-edit-player]"),del=e.target.closest("[data-delete-player]");
    if(edit)openPlayerDialog(edit.dataset.editPlayer);
    if(del)deletePlayer(del.dataset.deletePlayer);
  });
  $("#playerGrid").addEventListener("change",e=>{
    const sel=e.target.closest("[data-status-player]");if(!sel)return;
    const p=playerById(sel.dataset.statusPlayer);if(p){p.status=sel.value;save();renderPlayers();renderSetup();showToast(`${p.name}: ${sel.options[sel.selectedIndex].text}`);}
  });
  $$("#modePicker button").forEach(b=>b.addEventListener("click",()=>{state.settings.mode=b.dataset.mode;draftTeams={A:[],B:[]};save();renderSetup();}));
  $("#courtSelect").addEventListener("change",e=>{state.settings.court=e.target.value;save();});
  $("#durationSelect").addEventListener("change",e=>{state.settings.duration=Number(e.target.value);timer.initial=state.settings.duration*60;timer.remaining=timer.initial;save();renderSetup();});
  $$('input[name="strategy"]').forEach(r=>r.addEventListener("change",()=>{state.settings.strategy=r.value;save();renderSetup();}));
  $("#generateBtn").addEventListener("click",generateTeams);
  $("#teamASlots").addEventListener("change",e=>{const s=e.target.closest("select[data-team]");if(!s)return;draftTeams[s.dataset.team][Number(s.dataset.slot)]=s.value||null;renderSetup();});
  $("#teamBSlots").addEventListener("change",e=>{const s=e.target.closest("select[data-team]");if(!s)return;draftTeams[s.dataset.team][Number(s.dataset.slot)]=s.value||null;renderSetup();});
  $("#startMatchBtn").addEventListener("click",startMatch);
  $$(".score-controls button").forEach(b=>b.addEventListener("click",()=>changeScore(b.dataset.score,Number(b.dataset.delta))));
  $("#switchSidesBtn").addEventListener("click",()=>{const m=currentMatch();if(!m)return;m.switched=!m.switched;save();renderActive();showToast("Court sides switched.");});
  $("#timerStartBtn").addEventListener("click",toggleTimer);
  $("#timerResetBtn").addEventListener("click",resetTimer);
  $("#addMinuteBtn").addEventListener("click",addMinute);
  $$(".timer-presets button").forEach(b=>b.addEventListener("click",()=>setDuration(Number(b.dataset.minutes))));
  $("#resetScoreBtn").addEventListener("click",()=>{const m=currentMatch();if(!m)return;askConfirm("Reset the score?","Both teams will return to zero. The match timer will stay as it is.",()=>{m.score={A:0,B:0};save();renderActive();showToast("Score reset.");});});
  $("#finishMatchBtn").addEventListener("click",finishMatch);
  $("#historyList").addEventListener("click",e=>{const undo=e.target.closest("[data-undo-match]"),del=e.target.closest("[data-delete-match]");if(undo)undoMatch(undo.dataset.undoMatch);if(del)deleteHistoryRecord(del.dataset.deleteMatch);});
  $("#exportBtn").addEventListener("click",exportCSV);
  $("#resetAllStatsBtn").addEventListener("click",resetAllStats);
  $("#themeToggle").addEventListener("click",()=>{state.settings.theme=state.settings.theme==="dark"?"light":"dark";initTheme();save();});
  // Keep matchup setup usable on first launch, but don't seed fake players.
  initTheme();renderPlayers();renderSetup();renderHistory();renderStats();renderActive();updateHeader();
  if(state.activeMatch){navigate("active");}
})();
