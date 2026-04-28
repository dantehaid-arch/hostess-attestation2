let schema = null, currentUser = null, answers = {}, currentSection = 0;
const screens = { login: document.getElementById('login-screen'), test: document.getElementById('test-screen'), result: document.getElementById('result-screen') };

document.addEventListener('DOMContentLoaded', async () => {
  try { schema = await (await fetch('/api/schema')).json(); document.title = schema.meta.title; } 
  catch (err) { alert('❌ Ошибка загрузки теста'); console.error(err); }
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('prev-btn').addEventListener('click', () => nav(-1));
  document.getElementById('next-btn').addEventListener('click', () => nav(1));
  document.getElementById('submit-btn').addEventListener('click', submit);
  document.getElementById('restart-btn').addEventListener('click', restart);
});

function handleLogin(e) {
  e.preventDefault();
  currentUser = { name: document.getElementById('userName').value.trim(), position: document.getElementById('position').value.trim() };
  if (!currentUser.name || !currentUser.position) return alert('Заполните все поля');
  document.getElementById('display-name').textContent = currentUser.name;
  show('test'); render(); progress();
}
function handleLogout() { if(confirm('Выйти без сохранения?')) { currentUser=null; answers={}; currentSection=0; show('login'); } }
function show(n) { Object.values(screens).forEach(s=>s.classList.remove('active')); screens[n].classList.add('active'); }
function render() {
  const c = document.getElementById('sections-container'); c.innerHTML='';
  schema.sections.forEach((sec, i) => {
    const el = document.createElement('div'); el.className='section'; el.id=`sec-${i}`; el.style.display=i===currentSection?'block':'none';
    el.innerHTML = `<h3 class="section-title">${sec.title}</h3><p class="section-info">Макс. баллов: ${sec.maxScore}</p>${sec.questions.map(q=>renderQ(q)).join('')}`;
    c.appendChild(el);
  });
  updateNav(); attachEvents();
}
function renderQ(q) {
  const pts = `${q.points} ${q.points===1?'балл':q.points<5?'балла':'баллов'}`;
  const cur = answers[q.id]?.value;
  if(q.type==='single') return `<div class="question" data-qid="${q.id}"><p class="question-text">${q.text} <span class="question-points">[${pts}]</span></p><div class="options">${q.options.map(o=>`<label class="option"><input type="radio" name="${q.id}" value="${o.id}" ${cur===o.id?'checked':''}><span>${o.text}</span></label>`).join('')}</div></div>`;
  if(q.type==='multi') return `<div class="question" data-qid="${q.id}"><p class="question-text">${q.text} <span class="question-points">[${pts}]</span></p><div class="options">${q.options.map(o=>`<label class="option checkbox"><input type="checkbox" name="${q.id}" value="${o.id}" ${cur?.includes(o.id)?'checked':''}><span>${o.text}</span></label>`).join('')}</div><p class="hint">* Отметьте все подходящие</p></div>`;
  if(q.type==='truefalse') return `<div class="question" data-qid="${q.id}"><p class="question-text">${q.text} <span class="question-points">[${pts}]</span></p><div class="tf-options"><button type="button" class="tf-btn ${cur===true?'selected':''}" data-v="true">☑ ВЕРНО</button><button type="button" class="tf-btn ${cur===false?'selected':''}" data-v="false">☑ НЕВЕРНО</button></div>${q.explanation?`<p class="hint">💡 ${q.explanation}</p>`:''}</div>`;
  // 🔽 Убран placeholder с примером, убраны подсказки с ключевыми словами
  if(q.type==='text') return `<div class="question" data-qid="${q.id}"><p class="question-text">${q.text} <span class="question-points">[${pts}]</span></p>${q.situation?`<div class="scenario-box"><strong>СИТУАЦИЯ:</strong><br>${q.situation}</div>`:''}<textarea class="answer-input" placeholder="Введите ваш ответ здесь...">${cur||''}</textarea>${q.criteria?`<div class="criteria-preview"><small>📋 На что обратит внимание аттестатор:</small><ul>${q.criteria.map(c=>`<li>${c.text} (${c.weight}б)</li>`).join('')}</ul></div>`:''}</div>`;
  return '';
}

function attachEvents() {
  const c = document.getElementById('sections-container');
  c.replaceWith(c.cloneNode(true));
  const nc = document.getElementById('sections-container');
  nc.addEventListener('click', e => {
    const r = e.target.closest('input[type="radio"]');
    if(r) { answers[r.name]={value:r.value,timestamp:Date.now()}; progress(); return; }
    const cb = e.target.closest('input[type="checkbox"]');
    if(cb) { const q=cb.name; answers[q]={value:Array.from(document.querySelectorAll(`input[name="${q}"]:checked`)).map(c=>c.value),timestamp:Date.now()}; progress(); return; }
    const tf = e.target.closest('.tf-btn');
    if(tf) { const q=tf.closest('.question').dataset.qid; const v=tf.dataset.v==='true'; tf.closest('.tf-options').querySelectorAll('.tf-btn').forEach(b=>b.classList.remove('selected')); tf.classList.add('selected'); answers[q]={value:v,timestamp:Date.now()}; progress(); return; }
  });
  nc.addEventListener('input', e => {
    const ta = e.target.closest('.answer-input');
    if(ta) { answers[ta.closest('.question').dataset.qid]={value:ta.value.trim(),timestamp:Date.now()}; progress(); }
  });
}

function nav(dir) { save(); currentSection+=dir; if(currentSection<0||currentSection>=schema.sections.length) { currentSection-=dir; return; }
  document.getElementById(`sec-${currentSection-dir}`).style.display='none';
  document.getElementById(`sec-${currentSection}`).style.display='block';
  updateNav(); progress();
}
function save() { schema.sections[currentSection].questions.forEach(q => {
  if(q.type==='single') { const s=document.querySelector(`input[name="${q.id}"]:checked`); if(s&&!answers[q.id]) answers[q.id]={value:s.value,timestamp:Date.now()}; }
  else if(q.type==='multi') { const c=document.querySelectorAll(`input[name="${q.id}"]:checked`); if(c.length&&!answers[q.id]) answers[q.id]={value:Array.from(c).map(x=>x.value),timestamp:Date.now()}; }
  else if(q.type==='text') { const t=document.querySelector(`.question[data-qid="${q.id}"] .answer-input`); if(t?.value.trim()&&!answers[q.id]) answers[q.id]={value:t.value.trim(),timestamp:Date.now()}; }
}); }
function updateNav() { document.getElementById('prev-btn').disabled=currentSection===0; document.getElementById('next-btn').style.display=currentSection===schema.sections.length-1?'none':'inline-block'; document.getElementById('submit-btn').style.display=currentSection===schema.sections.length-1?'inline-block':'none'; }
function progress() { const tot=schema.sections.reduce((a,s)=>a+s.questions.length,0); const ans=Object.keys(answers).length; const p=Math.round(ans/tot*100); document.getElementById('progress-fill').style.width=`${p}%`; document.getElementById('progress-text').textContent=`${p}%`; }

async function submit() { save(); if(!confirm('Завершить? Изменить нельзя.')) return;
  const btn=document.getElementById('submit-btn'); btn.disabled=true; btn.textContent='Отправка...';
  try {
    const res=await fetch('/api/submit', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userName:currentUser.name, position:currentUser.position, answers})});
    const data=await res.json(); if(data.success) showResult(data); else throw new Error(data.error);
  } catch(e) { alert('❌ '+e.message); btn.disabled=false; btn.textContent='✅ Завершить'; }
}

function showResult(r) { show('result'); const s=r.score; document.getElementById('score-value').textContent=s.total; document.getElementById('score-max').textContent=s.max;
  const badge=document.getElementById('result-badge'), msg=document.getElementById('result-message');
  if(s.percentage>=schema.meta.passingScore) { badge.textContent='✅ Пройдено'; badge.className='badge passed'; msg.textContent=s.percentage>=90?'🌟 Отличный результат!':'Поздравляем! Аттестация пройдена.'; document.getElementById('result-title').textContent='🎉 Аттестация пройдена!'; }
  else { badge.textContent='📋 На проверке'; badge.className='badge pending'; msg.textContent='Открытые вопросы отправлены аттестатору.'; }
  const det=document.getElementById('result-details');
  det.innerHTML=`<h4>📊 Детализация:</h4><div class="result-item ${s.percentage>=70?'correct':'pending'}"><strong>Авто-баллы:</strong> ${s.total} / ${s.max} (${s.percentage}%)</div><div class="result-item"><strong>Дата:</strong> ${new Date().toLocaleDateString('ru-RU')}</div>`;
}
function restart() { if(confirm('Начать заново?')) { answers={}; currentSection=0; show('login'); document.getElementById('login-form').reset(); } }
