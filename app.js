
window.GO_BUILD_VERSION = "2026-05-30-R11";
(function(){
  "use strict";

  var STORAGE_TASKS = "go.rebuild.tasks.v1";
  var STORAGE_COMP = "go.rebuild.comp.v1";
  var STORAGE_TIMER = "go.rebuild.timer.v1";

  var COLORS = [
    "rgb(219,31,51)", "rgb(242,115,13)", "rgb(189,158,0)", "rgb(0,158,77)", "rgb(0,173,212)",
    "rgb(0,74,189)", "rgb(107,51,184)", "rgb(209,31,140)", "rgb(115,64,20)", "rgb(26,26,26)"
  ];
  var DAYS = [["月",2],["火",3],["水",4],["木",5],["金",6],["土",7],["日",1]];

  var S = {
    tasks: [],
    comp: {},
    timer: null,
    form: null,
    formMode: "new",
    editId: null,
    editing: false,
    editAction: null,
    selectedTaskId: null,
    reorderTaskId: null,
    confirmYes: null,
    autoCompleteLock: false,
    tickId: null,
    notifyIds: []
  };

  function el(id){ return document.getElementById(id); }
  function clamp(v,a,b){ v = Number(v); if(isNaN(v)) v = a; return Math.min(b, Math.max(a, v)); }
  function uid(){
    if(window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return String(Date.now()) + "-" + String(Math.random()).slice(2);
  }
  function getJSON(k, fallback){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }catch(e){ return fallback; } }
  function setJSON(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
  function removeKey(k){ localStorage.removeItem(k); }
  function escapeHTML(s){ return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function colorAlpha(rgb, a){ var n = rgb.match(/\d+/g); return "rgba("+n[0]+","+n[1]+","+n[2]+","+a+")"; }

  function normalizeTask(t){
    t = t || {};
    return {
      id: t.id || uid(),
      name: t.name || "タスク",
      workMinutes: snapToStep(t.workMinutes == null ? 25 : t.workMinutes, 5, 60, 5),
      extensionMinutes: snapToStep(t.extensionMinutes == null ? 5 : t.extensionMinutes, 0, Math.max(0, 60 - snapToStep(t.workMinutes == null ? 25 : t.workMinutes, 5, 60, 5)), 5),
      executionCount: clamp(t.executionCount == null ? 1 : t.executionCount, 1, 10),
      colorIndex: clamp(t.colorIndex == null ? 0 : t.colorIndex, 0, COLORS.length - 1),
      repeatWeekdays: Array.isArray(t.repeatWeekdays) && t.repeatWeekdays.length ? t.repeatWeekdays : [1,2,3,4,5,6,7],
      dayBoundaryHour: clamp(t.dayBoundaryHour == null ? 0 : t.dayBoundaryHour, 0, 23),
      dayBoundaryMinute: clamp(t.dayBoundaryMinute == null ? 0 : t.dayBoundaryMinute, 0, 59),
      notificationsEnabled: t.notificationsEnabled !== false,
      vibrationCount: clamp(t.vibrationCount == null ? 1 : t.vibrationCount, 1, 5)
    };
  }

  function load(){
    S.tasks = getJSON(STORAGE_TASKS, []).map(normalizeTask);
    S.comp = getJSON(STORAGE_COMP, {});
    S.timer = getJSON(STORAGE_TIMER, null);
    if(!S.tasks.length){
      S.tasks = [
        normalizeTask({name:"原稿", workMinutes:25, extensionMinutes:5, executionCount:3, colorIndex:5}),
        normalizeTask({name:"ストレッチ", workMinutes:10, extensionMinutes:0, executionCount:2, colorIndex:2}),
        normalizeTask({name:"読書", workMinutes:20, extensionMinutes:5, executionCount:1, colorIndex:9})
      ];
      saveTasks();
    }
    validateTimer();
  }
  function saveTasks(){ setJSON(STORAGE_TASKS, S.tasks); }
  function saveComp(){ setJSON(STORAGE_COMP, S.comp); }
  function saveTimer(){ if(S.timer) setJSON(STORAGE_TIMER, S.timer); else removeKey(STORAGE_TIMER); }

  function validateTimer(){
    if(!S.timer) return;
    var ok = S.tasks.some(function(t){ return t.id === S.timer.taskId; });
    if(!ok){ S.timer = null; saveTimer(); }
  }

  function appDayStart(date, task){
    var d = new Date(date);
    var b = new Date(d.getFullYear(), d.getMonth(), d.getDate(), task.dayBoundaryHour, task.dayBoundaryMinute, 0, 0);
    if(d < b) b.setDate(b.getDate() - 1);
    return b;
  }
  function dayKey(date, task){
    var d = appDayStart(date, task);
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  }
  function appWeekday(date, task){
    var js = appDayStart(date, task).getDay();
    return js === 0 ? 1 : js + 1;
  }
  function tasksToday(){
    var now = new Date();
    return S.tasks.filter(function(t){ return t.repeatWeekdays.indexOf(appWeekday(now,t)) !== -1; });
  }
  function completedCount(task){
    var key = dayKey(new Date(), task);
    var count = S.comp[key] && S.comp[key][task.id] ? S.comp[key][task.id] : 0;
    return clamp(count, 0, task.executionCount);
  }
  function isCompleted(task){ return completedCount(task) >= task.executionCount; }
  function markCompleted(task){
    var key = dayKey(new Date(), task);
    if(!S.comp[key]) S.comp[key] = {};
    var cur = clamp(S.comp[key][task.id] || 0, 0, task.executionCount);
    if(cur < task.executionCount){
      S.comp[key][task.id] = cur + 1;
      saveComp();
    }
  }
  function orderedToday(){
    var base = tasksToday();
    return base.slice().sort(function(a,b){
      var ac = isCompleted(a), bc = isCompleted(b);
      if(ac !== bc) return ac ? 1 : -1;
      return base.indexOf(a) - base.indexOf(b);
    });
  }

  function showScreen(id){
    var screens = document.querySelectorAll(".screen");
    for(var i=0;i<screens.length;i++){ screens[i].classList.remove("active"); screens[i].style.display = "none"; }
    el(id).classList.add("active");
    el(id).style.display = "block";
  }

  function indicatorHTML(task, count, timerClass){
    var done = clamp(count,0,task.executionCount);
    var total = task.executionCount;
    var r1 = "", r2 = "";
    for(var i=0;i<Math.min(5,total);i++) r1 += boxHTML(i < done, task.colorIndex);
    for(var j=5;j<total;j++) r2 += boxHTML(j < done, task.colorIndex);
    return '<span class="indicator '+(timerClass?"timer":"")+'"><span class="indRow">'+r1+'</span>'+(r2?'<span class="indRow">'+r2+'</span>':"")+'</span>';
  }
  function boxHTML(done, colorIndex){
    var c = COLORS[colorIndex];
    return '<span class="box" style="color:'+c+';background:'+(done?c:colorAlpha(c,.20))+'"></span>';
  }

  function renderHome(){
    showScreen("homeScreen");
    var now = new Date();
    el("weekdayText").textContent = now.toLocaleDateString("en-US",{weekday:"long"}).toUpperCase();
    var homeList = orderedToday();
    var editList = tasksToday();
    el("taskCount").textContent = homeList.length;
    el("editTaskCount").textContent = editList.length;
    renderTaskList(el("taskList"), homeList, false);
    renderTaskList(el("editTaskList"), editList, true);
    renderPie(homeList);
    renderEditMode();
  }
  function updateHomeClockAndChartOnly(){
    var now = new Date();
    el("weekdayText").textContent = now.toLocaleDateString("en-US",{weekday:"long"}).toUpperCase();
    var homeList = orderedToday();
    var editList = tasksToday();
    el("taskCount").textContent = homeList.length;
    el("editTaskCount").textContent = editList.length;
    renderTaskList(el("taskList"), homeList, false);
    renderTaskList(el("editTaskList"), editList, true);
    renderPie(homeList);
    renderEditMode();
  }


  function renderTaskList(container, list, edit){
    container.innerHTML = "";
    if(!list.length){
      container.innerHTML = '<div class="emptyState">右下の＋からタスクを登録</div>';
      return;
    }
    list.forEach(function(task){
      var b = document.createElement("button");
      b.className = "taskRow";
      if(!edit && isCompleted(task)) b.classList.add("completed");
      if(S.editAction && S.selectedTaskId === task.id) b.classList.add("target");
      if(S.editAction && S.selectedTaskId && S.selectedTaskId !== task.id) b.classList.add("dimmed");
      if(edit && S.reorderTaskId === task.id) b.classList.add("target");
      b.innerHTML =
        '<span class="taskDot" style="background:'+COLORS[task.colorIndex]+'"></span>'+
        '<span class="taskName">'+escapeHTML(task.name)+'</span>'+
        indicatorHTML(task, completedCount(task), false)+
        (edit?'<span class="reorderHandle" aria-hidden="true">≡</span>':'');
      b.onclick = function(){
        if(edit){
          if(S.reorderTaskId){
            if(S.reorderTaskId === task.id){
              S.reorderTaskId = null;
              renderHome();
              return;
            }
            reorderTask(S.reorderTaskId, task.id);
            S.reorderTaskId = null;
            renderHome();
            return;
          }
          if(S.editAction){
            S.selectedTaskId = task.id;
            renderHome();
            setTimeout(function(){
              confirmAction(task.name + (S.editAction === "duplicate" ? "を複製" : "を削除"), function(){
                if(S.editAction === "duplicate") duplicateTask(task);
                if(S.editAction === "delete") deleteTask(task);
                S.editAction = null; S.selectedTaskId = null; renderHome();
              }, S.editAction === "delete");
            }, 120);
          }else{
            openForm("edit", task.id);
          }
        }else{
          openTimer(task.id);
        }
      };
      if(edit){
        setupReorderHandle(b.querySelector(".reorderHandle"), task, b);
      }
      container.appendChild(b);
    });
  }

  function setupReorderHandle(handle, task, row){
    if(!handle) return;
    var timer = null;
    var moved = false;
    var sx = 0;
    var sy = 0;

    function clearTimer(){
      if(timer){ clearTimeout(timer); timer = null; }
    }

    function activate(){
      S.editAction = null;
      S.selectedTaskId = null;
      S.reorderTaskId = task.id;
      renderHome();
    }

    handle.addEventListener("pointerdown", function(e){
      e.preventDefault();
      e.stopPropagation();
      sx = e.clientX;
      sy = e.clientY;
      moved = false;
      clearTimer();
      timer = setTimeout(activate, 420);
    });

    handle.addEventListener("pointermove", function(e){
      if(Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10){
        moved = true;
      }
    });

    handle.addEventListener("pointerup", function(e){
      e.preventDefault();
      e.stopPropagation();
      // 長押し前に離した場合は何もしない
      if(!S.reorderTaskId || S.reorderTaskId !== task.id){
        clearTimer();
      }
    });

    handle.addEventListener("pointercancel", function(){
      clearTimer();
    });
  }

  function reorderTask(sourceId, targetId){
    if(sourceId === targetId) return;
    var from = S.tasks.findIndex(function(t){ return t.id === sourceId; });
    var to = S.tasks.findIndex(function(t){ return t.id === targetId; });
    if(from < 0 || to < 0) return;
    var item = S.tasks.splice(from, 1)[0];
    S.tasks.splice(to, 0, item);
    saveTasks();
  }

  function renderPie(list){
    var c = el("pieCanvas"), ctx = c.getContext("2d");
    var w = c.width, h = c.height, cx = w/2, cy = h/2, r = Math.min(w,h)/2 - 8;
    ctx.clearRect(0,0,w,h);
    if(!list.length){
      ctx.beginPath(); ctx.arc(cx,cy,r-16,0,Math.PI*2); ctx.lineWidth = 44; ctx.strokeStyle = "rgba(0,0,0,.08)"; ctx.stroke(); return;
    }
    var total = list.reduce(function(sum,t){ return sum + Math.max(1,(t.workMinutes+t.extensionMinutes)*60) * t.executionCount; }, 0);
    var start = -Math.PI/2;
    list.forEach(function(t){
      var span = Math.PI*2 * (Math.max(1,(t.workMinutes+t.extensionMinutes)*60) * t.executionCount / total);
      slice(ctx,cx,cy,r,start,start+span,colorAlpha(COLORS[t.colorIndex],.20));
      var doneSpan = span * (completedCount(t)/Math.max(1,t.executionCount));
      if(doneSpan > 0) slice(ctx,cx,cy,r,start,start+doneSpan,COLORS[t.colorIndex]);
      start += span;
    });
  }
  function slice(ctx,cx,cy,r,a,b,fill){ ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,a,b); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }

  function renderEditMode(){
    el("editDim").style.display = S.editing ? "block" : "none";
    el("editPanel").style.display = S.editing ? "block" : "none";
    el("editDim").classList.toggle("deep", !!S.editAction);
    el("duplicateModeButton").classList.toggle("active", S.editAction === "duplicate");
    el("deleteModeButton").classList.toggle("active", S.editAction === "delete");
    el("editInstruction").textContent = S.reorderTaskId ? "移動先のタスクをタップ" : S.editAction === "duplicate" ? "複製するタスクを選択" : S.editAction === "delete" ? "削除するタスクを選択" : "";
  }

  function openForm(mode, id){
    S.formMode = mode; S.editId = id || null;
    var task = id ? S.tasks.find(function(t){ return t.id === id; }) : null;
    S.form = task ? JSON.parse(JSON.stringify(task)) : normalizeTask({name:""});
    S.editing = false; S.editAction = null; S.selectedTaskId = null;
    showScreen("formScreen");
    renderForm();
  }
  function snapToStep(value, minValue, maxValue, step) {
    var safeStep = Math.max(1, Number(step) || 1);
    var safeMin = Number(minValue) || 0;
    var safeMax = Number(maxValue);
    if(!Number.isFinite(safeMax)) safeMax = safeMin;
    var clamped = clamp(value, safeMin, safeMax);
    var snapped = safeMin + Math.round((clamped - safeMin) / safeStep) * safeStep;
    return clamp(snapped, safeMin, safeMax);
  }

  function setNumberStepper(id, minValue, maxValue, value, step, onChange){
    var root = el(id);
    if(!root) return;
    var safeMin = Number(minValue) || 0;
    var safeMax = Number(maxValue);
    if(!Number.isFinite(safeMax)) safeMax = safeMin;
    var safeStep = Math.max(1, Number(step) || 1);
    var current = snapToStep(value, safeMin, safeMax, safeStep);

    if(!root.dataset.ready){
      root.innerHTML = '' +
        '<button type="button" class="stepperButton minus" aria-label="減らす">−</button>' +
        '<div class="stepperValue" aria-live="polite"></div>' +
        '<button type="button" class="stepperButton plus" aria-label="増やす">＋</button>' ;
      root.dataset.ready = '1';
    }

    var minus = root.querySelector('.minus');
    var plus = root.querySelector('.plus');
    var valueNode = root.querySelector('.stepperValue');

    valueNode.textContent = String(current);
    root.dataset.value = String(current);

    var atMin = current <= safeMin;
    var atMax = current >= safeMax;
    minus.disabled = atMin;
    plus.disabled = atMax;
    minus.classList.toggle('disabled', atMin);
    plus.classList.toggle('disabled', atMax);

    minus.onclick = function(){
      if(current <= safeMin) return;
      var next = snapToStep(current - safeStep, safeMin, safeMax, safeStep);
      if(onChange) onChange(next);
    };
    plus.onclick = function(){
      if(current >= safeMax) return;
      var next = snapToStep(current + safeStep, safeMin, safeMax, safeStep);
      if(onChange) onChange(next);
    };
  }

  function renderForm(){
    var f = S.form;
    el("formTitle").textContent = S.formMode === "new" ? "新規登録" : "編集";
    el("formEditActions").style.display = S.formMode === "edit" ? "flex" : "none";
    el("taskNameInput").value = f.name;
    f.workMinutes = snapToStep(f.workMinutes, 5, 60, 5);
    var maxExtensionMinutes = Math.max(0, 60 - clamp(f.workMinutes,5,60));
    f.extensionMinutes = snapToStep(f.extensionMinutes,0,maxExtensionMinutes,5);
    f.executionCount = clamp(f.executionCount,1,10);
    f.dayBoundaryHour = clamp(f.dayBoundaryHour,0,23);
    f.dayBoundaryMinute = snapToStep(f.dayBoundaryMinute,0,55,5);
    f.vibrationCount = clamp(f.vibrationCount,1,5);

    setNumberStepper("workStepper",5,60,f.workMinutes,5,function(value){
      S.form.workMinutes = value;
      S.form.extensionMinutes = snapToStep(S.form.extensionMinutes,0,Math.max(0,60-value),5);
      renderForm();
    });
    setNumberStepper("extensionStepper",0,maxExtensionMinutes,f.extensionMinutes,5,function(value){ S.form.extensionMinutes = value; renderForm(); });
    setNumberStepper("countStepper",1,10,f.executionCount,1,function(value){ S.form.executionCount = value; renderForm(); });
    setNumberStepper("boundaryHourStepper",0,23,f.dayBoundaryHour,1,function(value){ S.form.dayBoundaryHour = value; renderForm(); });
    setNumberStepper("boundaryMinuteStepper",0,55,f.dayBoundaryMinute,5,function(value){ S.form.dayBoundaryMinute = value; renderForm(); });
    setNumberStepper("vibrationStepper",1,5,f.vibrationCount,1,function(value){ S.form.vibrationCount = value; renderForm(); });

    var grid = el("colorGrid"); grid.innerHTML = "";
    COLORS.forEach(function(c,i){
      var b = document.createElement("button");
      b.className = "colorButton" + (f.colorIndex===i?" selected":"");
      b.style.background = c;
      b.onclick = function(){ S.form.colorIndex = i; renderForm(); };
      grid.appendChild(b);
    });

    el("everydayButton").textContent = isEveryday(f.repeatWeekdays) ? "● 毎日" : "○ 毎日";
    var days = el("weekdayButtons"); days.innerHTML = "";
    DAYS.forEach(function(d){
      var b = document.createElement("button");
      b.className = "dayButton" + (f.repeatWeekdays.indexOf(d[1]) !== -1 ? " selected" : "");
      b.textContent = d[0];
      b.onclick = function(){
        if(f.repeatWeekdays.indexOf(d[1]) !== -1) f.repeatWeekdays = f.repeatWeekdays.filter(function(x){ return x !== d[1]; });
        else f.repeatWeekdays.push(d[1]);
        renderForm();
      };
      days.appendChild(b);
    });

    el("notificationToggle").classList.toggle("on", f.notificationsEnabled);
    el("notificationToggle").style.background = f.notificationsEnabled ? COLORS[f.colorIndex] : "rgba(0,0,0,.14)";
    el("notificationText").style.display = f.notificationsEnabled ? "block" : "none";
    el("vibrationWrap").style.display = f.notificationsEnabled ? "grid" : "none";
  }
  function isEveryday(arr){ return [1,2,3,4,5,6,7].every(function(x){ return arr.indexOf(x)!==-1; }) && arr.length === 7; }
  function readForm(){
    var f = S.form;
    f.name = el("taskNameInput").value.trim();
    f.workMinutes = snapToStep(f.workMinutes,5,60,5);
    f.extensionMinutes = snapToStep(f.extensionMinutes,0,Math.max(0,60-f.workMinutes),5);
    f.executionCount = clamp(f.executionCount,1,10);
    f.dayBoundaryHour = clamp(f.dayBoundaryHour,0,23);
    f.dayBoundaryMinute = snapToStep(f.dayBoundaryMinute,0,55,5);
    f.vibrationCount = clamp(f.vibrationCount,1,5);
    if(!f.repeatWeekdays.length) f.repeatWeekdays = [1,2,3,4,5,6,7];
    return normalizeTask(f);
  }
  function saveForm(){
    var t = readForm();
    if(!t.name) return;
    if(S.formMode === "new") S.tasks.push(t);
    else{
      var i = S.tasks.findIndex(function(x){ return x.id === t.id; });
      if(i>=0) S.tasks[i] = t;
    }
    saveTasks(); renderHome();
  }
  function duplicateTask(t){ var c = JSON.parse(JSON.stringify(t)); c.id = uid(); c.name = t.name + " copy"; S.tasks.push(c); saveTasks(); }
  function deleteTask(t){ S.tasks = S.tasks.filter(function(x){ return x.id !== t.id; }); Object.keys(S.comp).forEach(function(k){ if(S.comp[k]) delete S.comp[k][t.id]; }); if(S.timer && S.timer.taskId === t.id) stopTimer(); saveTasks(); saveComp(); }

  function openTimer(id){
    var t = S.tasks.find(function(x){ return x.id === id; });
    if(!t){ renderHome(); return; }
    el("timerName").textContent = t.name;
    el("timerTrack").setAttribute("stroke", colorAlpha(COLORS[t.colorIndex],.16));
    el("timerProgress").setAttribute("stroke", COLORS[t.colorIndex]);
    el("completeCircle").style.background = COLORS[t.colorIndex];
    showScreen("timerScreen");
    renderTimer();
  }
  function currentTask(){
    if(S.timer) return S.tasks.find(function(t){ return t.id === S.timer.taskId; });
    var name = el("timerName").textContent;
    return S.tasks.find(function(t){ return t.name === name; }) || S.tasks[0];
  }
  function startTimer(t){
    var now = Date.now();
    S.timer = { taskId:t.id, workEnd:now+t.workMinutes*60000, extensionEnd:now+(t.workMinutes+t.extensionMinutes)*60000, paused:false, pausedPhase:"work", pausedRemaining:0, didWork:false, didExt:false };
    saveTimer();
    if(t.notificationsEnabled && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
    scheduleNotifications(t);
  }
  function pauseTimer(t){
    if(!S.timer || S.timer.taskId !== t.id || S.timer.paused) return;
    var s = snapshot(t);
    S.timer.paused = true; S.timer.pausedPhase = s.phase; S.timer.pausedRemaining = s.remaining;
    clearNotify(); saveTimer();
  }
  function resumeTimer(t){
    if(!S.timer || S.timer.taskId !== t.id || !S.timer.paused) return;
    var now = Date.now(), r = Math.max(0,S.timer.pausedRemaining || 0);
    if(S.timer.pausedPhase === "work"){ S.timer.workEnd = now + r; S.timer.extensionEnd = S.timer.workEnd + t.extensionMinutes*60000; }
    else{ S.timer.workEnd = now; S.timer.extensionEnd = now + r; }
    S.timer.paused = false; saveTimer(); scheduleNotifications(t);
  }
  function stopTimer(){ clearNotify(); S.timer = null; S.autoCompleteLock = false; saveTimer(); }
  function snapshot(t){
    if(!S.timer || S.timer.taskId !== t.id) return {phase:"work", remaining:t.workMinutes*60000, progress:0, paused:false};
    if(S.timer.paused){
      var totalP = S.timer.pausedPhase === "work" ? t.workMinutes*60000 : Math.max(1,t.extensionMinutes*60000);
      var remP = Math.min(totalP, Math.max(0,S.timer.pausedRemaining));
      return {phase:S.timer.pausedPhase, remaining:remP, progress:1-remP/totalP, paused:true};
    }
    var now = Date.now();
    if(now < S.timer.workEnd){
      var totalW = t.workMinutes*60000, remW = Math.min(totalW, Math.max(0,S.timer.workEnd-now));
      return {phase:"work", remaining:remW, progress:1-remW/totalW, paused:false};
    }
    if(t.extensionMinutes <= 0){
      return {phase:"extension", remaining:0, progress:1, paused:false};
    }
    var totalE = Math.max(1,t.extensionMinutes*60000), remE = Math.min(totalE, Math.max(0,S.timer.extensionEnd-now));
    return {phase:"extension", remaining:remE, progress:1-remE/totalE, paused:false};
  }
  function formatTime(ms){
    var total = Math.ceil(Math.max(0,ms)/1000), h=Math.floor(total/3600), m=Math.floor((total%3600)/60), s=total%60;
    return h>0 ? h+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0") : String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
  }
  function renderTimer(){
    var t = currentTask();
    if(!t){ stopTimer(); renderHome(); return; }
    var s = snapshot(t);
    if(S.timer && S.timer.taskId === t.id && !S.autoCompleteLock){
      var due = t.extensionMinutes <= 0 ? Date.now() >= S.timer.workEnd : (s.phase === "extension" && s.remaining <= 0);
      if(due){
        S.autoCompleteLock = true;
        showComplete(t, function(){ markCompleted(t); stopTimer(); renderHome(); }, false);
        return;
      }
    }
    el("timerName").textContent = t.name;
    el("timerPhase").textContent = s.phase === "work" ? "実行時間" : "延長時間";
    el("timerText").textContent = formatTime(s.remaining);
    el("playPauseButton").textContent = (!S.timer || S.timer.taskId !== t.id || S.timer.paused) ? "▶" : "Ⅱ";
    el("playPauseButton").style.background = COLORS[t.colorIndex];
    el("timerExecutionIndicator").innerHTML = indicatorHTML(t, completedCount(t), true);
    var circ = 2*Math.PI*122;
    el("timerProgress").style.strokeDasharray = String(circ);
    el("timerProgress").style.strokeDashoffset = String(circ*(1-Math.max(0,Math.min(1,s.progress))));
    checkForegroundNotice(t);
  }
  function clearNotify(){ S.notifyIds.forEach(function(id){ clearTimeout(id); }); S.notifyIds = []; }
  function scheduleNotifications(t){
    clearNotify();
    if(!S.timer || S.timer.taskId !== t.id || S.timer.paused) return;
    if(!S.timer.didWork){
      S.notifyIds.push(setTimeout(function(){ if(S.timer && S.timer.taskId === t.id && !S.timer.didWork){ S.timer.didWork = true; notify(t,"実行時間　完了"); saveTimer(); renderTimer(); scheduleNotifications(t); } }, Math.max(1,S.timer.workEnd-Date.now()+80)));
    }
    if(t.extensionMinutes > 0 && !S.timer.didExt){
      S.notifyIds.push(setTimeout(function(){ if(S.timer && S.timer.taskId === t.id && !S.timer.didExt){ S.timer.didExt = true; notify(t,"延長時間　完了"); saveTimer(); renderTimer(); } }, Math.max(1,S.timer.extensionEnd-Date.now()+80)));
    }
  }
  function checkForegroundNotice(t){
    if(!S.timer || S.timer.taskId !== t.id || S.timer.paused) return;
    var now = Date.now();
    if(!S.timer.didWork && now >= S.timer.workEnd){ S.timer.didWork = true; notify(t,"実行時間　完了"); saveTimer(); scheduleNotifications(t); }
    if(t.extensionMinutes > 0 && !S.timer.didExt && now >= S.timer.extensionEnd){ S.timer.didExt = true; notify(t,"延長時間　完了"); saveTimer(); }
  }
  function notify(t, body){
    if(!t.notificationsEnabled) return;
    if("Notification" in window && Notification.permission === "granted"){
      try{ new Notification(t.name, {body:body, icon:"icons/icon-192.png"}); }catch(e){}
    }
    if("vibrate" in navigator){
      for(var i=0;i<t.vibrationCount;i++) setTimeout(function(){ navigator.vibrate(120); }, i*280);
    }
  }

  function showComplete(t, done, autoReturn){
    var o = el("completeOverlay");
    el("completeCircle").style.background = COLORS[t.colorIndex];
    o.classList.add("show");
    o.style.display = "grid";
    var finish = function(){
      o.onclick = null;
      o.classList.remove("show");
      o.style.display = "none";
      done();
    };
    if(autoReturn) setTimeout(finish, 900);
    else o.onclick = finish;
  }

  function confirmAction(text, yes, danger){
    S.confirmYes = yes;
    el("confirmText").textContent = text;
    el("confirmYes").style.color = danger ? "var(--danger)" : "var(--text)";
    el("confirmOverlay").style.display = "grid";
  }
  function closeConfirm(clearSelection){
    S.confirmYes = null;
    el("confirmOverlay").style.display = "none";
    if(clearSelection){
      S.selectedTaskId = null;
      S.editAction = null;
      if(el("homeScreen").classList.contains("active")){
        renderHome();
      }
    }
  }

  function bind(){
    el("addButton").onclick = function(){ openForm("new"); };
    el("editButton").onclick = function(){ S.editing = !S.editing; S.editAction = null; S.selectedTaskId = null; S.reorderTaskId = null; renderHome(); };
    el("editDim").onclick = function(){ if(S.editAction){ S.editAction=null; S.selectedTaskId=null; } else S.editing=false; renderHome(); };
    el("duplicateModeButton").onclick = function(){ S.editAction = S.editAction === "duplicate" ? null : "duplicate"; S.selectedTaskId=null; S.reorderTaskId=null; renderHome(); };
    el("deleteModeButton").onclick = function(){ S.editAction = S.editAction === "delete" ? null : "delete"; S.selectedTaskId=null; S.reorderTaskId=null; renderHome(); };

    el("cancelButton").onclick = renderHome;
    el("saveButton").onclick = saveForm;
    el("everydayButton").onclick = function(){ S.form.repeatWeekdays = isEveryday(S.form.repeatWeekdays) ? [] : [1,2,3,4,5,6,7]; renderForm(); };
    el("notificationToggle").onclick = function(){ S.form.notificationsEnabled = !S.form.notificationsEnabled; renderForm(); };
    el("duplicateFromFormButton").onclick = function(){ var t=S.tasks.find(function(x){return x.id===S.editId;}); if(t) confirmAction(t.name+"を複製", function(){ duplicateTask(t); closeConfirm(false); renderHome(); }, false); };
    el("deleteFromFormButton").onclick = function(){ var t=S.tasks.find(function(x){return x.id===S.editId;}); if(t) confirmAction(t.name+"を削除", function(){ deleteTask(t); closeConfirm(false); renderHome(); }, true); };

    el("timerStopButton").onclick = function(){ var t=currentTask(); if(!t){ stopTimer(); renderHome(); return; } confirmAction(t.name+"を中止", function(){ stopTimer(); closeConfirm(false); renderHome(); }, true); };
    el("playPauseButton").onclick = function(){ var t=currentTask(); if(!t){ renderHome(); return; } if(!S.timer || S.timer.taskId !== t.id) startTimer(t); else if(S.timer.paused) resumeTimer(t); else pauseTimer(t); renderTimer(); };
    el("manualCompleteButton").onclick = function(){ var t=currentTask(); if(!t){ renderHome(); return; } showComplete(t, function(){ markCompleted(t); stopTimer(); renderHome(); }, true); };

    el("confirmNo").onclick = function(){ closeConfirm(true); };
    el("confirmYes").onclick = function(){ var fn = S.confirmYes; closeConfirm(false); if(fn) fn(); };
    el("confirmOverlay").onclick = function(e){ if(e.target.id === "confirmOverlay") closeConfirm(true); };

    el("taskNameInput").oninput = function(){ if(S.form) S.form.name = el("taskNameInput").value; };
  }

  function init(){
    load();
    bind();
    renderHome();
    if(S.tickId) clearInterval(S.tickId);
    S.tickId = setInterval(function(){
      if(el("timerScreen").classList.contains("active")){
        renderTimer();
      }else if(el("homeScreen").classList.contains("active")){
        updateHomeClockAndChartOnly();
      }
    }, 500);

    // 過去版のService Worker/Cache事故を避けるため、この作り直し版ではSWを使わない
    if("serviceWorker" in navigator){
      navigator.serviceWorker.getRegistrations().then(function(regs){ regs.forEach(function(r){ r.unregister(); }); }).catch(function(){});
    }
    if("caches" in window){
      caches.keys().then(function(keys){ keys.forEach(function(k){ caches.delete(k); }); }).catch(function(){});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
