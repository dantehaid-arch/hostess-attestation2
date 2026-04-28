// === Глобальные переменные ===
let schema = null;
let currentUser = null;
let answers = {};
let currentSectionIndex = 0;
let autoScoreDetails = {}; // { questionId: { earned, max, feedback } }

// === DOM элементы ===
const screens = {
  login: document.getElementById('login-screen'),
  test: document.getElementById('test-screen'),
  result: document.getElementById('result-screen')
};

// === ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await fetch('/api/schema');
    schema = await response.json();
    document.title = schema.meta.title;
  } catch (err) {
    alert('❌ Не удалось загрузить тест. Проверьте соединение.');
    console.error(err);
  }
  
  // Обработчики
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('prev-btn').addEventListener('click', () => navigateSection(-1));
  document.getElementById('next-btn').addEventListener('click', () => navigateSection(1));
  document.getElementById('submit-btn').addEventListener('click', handleSubmit);
  document.getElementById('restart-btn').addEventListener('click', handleRestart);
});

// === ВХОД ===
function handleLogin(e) {
  e.preventDefault();
  currentUser = {
    name: document.getElementById('userName').value.trim(),
    position: document.getElementById('position').value.trim()
  };
  if (!currentUser.name || !currentUser.position) {
    alert('Заполните все поля');
    return;
  }
  document.getElementById('display-name').textContent = currentUser.name;
  showScreen('test');
  renderTest();
  updateProgress();
}

function handleLogout() {
  if (confirm('Завершить тест без сохранения?')) {
    currentUser = null;
    answers = {};
    autoScoreDetails = {};
    currentSectionIndex = 0;
    showScreen('login');
  }
}

// === НАВИГАЦИЯ ===
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function renderTest() {
  const container = document.getElementById('sections-container');
  container.innerHTML = '';
  
  schema.sections.forEach((section, sIdx) => {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'section';
    sectionEl.id = `section-${sIdx}`;
    sectionEl.style.display = sIdx === currentSectionIndex ? 'block' : 'none';
    
    sectionEl.innerHTML = `
      <h3 class="section-title">${section.title}</h3>
      <p class="section-info">Макс. баллов: ${section.maxScore}</p>
      ${section.questions.map(q => renderQuestion(q)).join('')}
    `;
    container.appendChild(sectionEl);
  });
  
  updateNavigation();
  attachEventListeners();
}

function renderQuestion(q) {
  const pointsText = `${q.points} ${q.points === 1 ? 'балл' : q.points < 5 ? 'балла' : 'баллов'}`;
  const currentValue = answers[q.id]?.value;
  
  switch (q.type) {
    case 'single':
      return `
        <div class="question" data-qid="${q.id}">
          <p class="question-text">${q.text} <span class="question-points">[${pointsText}]</span></p>
          <div class="options">
            ${q.options.map(opt => `
              <label class="option">
                <input type="radio" name="${q.id}" value="${opt.id}" ${currentValue === opt.id ? 'checked' : ''}>
                <span>${opt.text}</span>
              </label>
            `).join('')}
          </div>
        </div>
      `;
      
    case 'multi':
      const checkedValues = currentValue || [];
      return `
        <div class="question" data-qid="${q.id}">
          <p class="question-text">${q.text} <span class="question-points">[${pointsText}]</span></p>
          <div class="options">
            ${q.options.map(opt => `
              <label class="option checkbox">
                <input type="checkbox" name="${q.id}" value="${opt.id}" ${checkedValues.includes(opt.id) ? 'checked' : ''}>
                <span>${opt.text}</span>
              </label>
            `).join('')}
          </div>
          <p class="hint">* Отметьте все подходящие варианты</p>
        </div>
      `;
      
    case 'truefalse':
      return `
        <div class="question" data-qid="${q.id}">
          <p class="question-text">${q.text} <span class="question-points">[${pointsText}]</span></p>
          <div class="tf-options">
            <button type="button" class="tf-btn ${currentValue === true ? 'selected correct' : ''}" data-value="true">☑ ВЕРНО</button>
            <button type="button" class="tf-btn ${currentValue === false ? 'selected incorrect' : ''}" data-value="false">☑ НЕВЕРНО</button>
          </div>
          ${q.explanation ? `<p class="hint" style="margin-top:0.5rem;color:#666;font-size:0.9rem">💡 ${q.explanation}</p>` : ''}
        </div>
      `;
      
    case 'text':
      return `
        <div class="question" data-qid="${q.id}">
          <p class="question-text">${q.text} <span class="question-points">[${pointsText}]</span></p>
          ${q.subtype === 'scenario' || q.subtype === 'case' ? `<div class="scenario-box"><strong>СИТУАЦИЯ:</strong><br>${q.situation}</div>` : ''}
          <textarea class="answer-input" placeholder="${q.placeholder || 'Ваш ответ...'}">${currentValue || ''}</textarea>
          ${q.evaluationCriteria ? `
            <div class="criteria-preview">
              <small>📋 На что обратит внимание аттестатор:</small>
              <ul>${q.evaluationCriteria.map(c => `<li>${c}</li>`).join('')}</ul>
            </div>
          ` : ''}
          ${q.autoCheckKeywords ? `<p class="hint">💡 Подсказка: в ответе должны быть слова: ${q.autoCheckKeywords.slice(0,3).join(', ')}...</p>` : ''}
        </div>
      `;
      
    default:
      return '';
  }
}

// === ОБРАБОТЧИКИ СОБЫТИЙ ===
function attachEventListeners() {
  // Radio
  document.querySelectorAll('input[type="radio"]').forEach(input => {
    input.addEventListener('change', (e) => {
      const qid = e.target.name;
      answers[qid] = { value: e.target.value, timestamp: Date.now() };
      updateProgress();
    });
  });
  
  // Checkbox
  document.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', (e) => {
      const qid = e.target.name;
      const checked = document.querySelectorAll(`input[name="${qid}"]:checked`);
      answers[qid] = { 
        value: Array.from(checked).map(c => c.value), 
        timestamp: Date.now() 
      };
      updateProgress();
    });
  });
  
  // True/False
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const questionEl = e.target.closest('.question');
      const qid = questionEl.dataset.qid;
      const value = e.target.dataset.value === 'true';
      questionEl.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('selected'));
      e.target.classList.add('selected');
      answers[qid] = { value, timestamp: Date.now() };
      updateProgress();
    });
  });
  
  // Textarea
  document.querySelectorAll('.answer-input').forEach(textarea => {
    textarea.addEventListener('input', (e) => {
      const qid = e.target.closest('.question').dataset.qid;
      answers[qid] = { value: e.target.value, timestamp: Date.now() };
      updateProgress();
    });
  });
}

function navigateSection(direction) {
  saveCurrentSectionAnswers();
  const newIndex = currentSectionIndex + direction;
  if (newIndex < 0 || newIndex >= schema.sections.length) return;
  document.getElementById(`section-${currentSectionIndex}`).style.display = 'none';
  currentSectionIndex = newIndex;
  document.getElementById(`section-${currentSectionIndex}`).style.display = 'block';
  updateNavigation();
  updateProgress();
}

function saveCurrentSectionAnswers() {
  const currentSection = schema.sections[currentSectionIndex];
  currentSection.questions.forEach(q => {
    if (q.type === 'single') {
      const selected = document.querySelector(`input[name="${q.id}"]:checked`);
      if (selected && !answers[q.id]) {
        answers[q.id] = { value: selected.value, timestamp: Date.now() };
      }
    } else if (q.type === 'multi') {
      const checked = document.querySelectorAll(`input[name="${q.id}"]:checked`);
      if (checked.length > 0 && !answers[q.id]) {
        answers[q.id] = { value: Array.from(checked).map(c => c.value), timestamp: Date.now() };
      }
    } else if (q.type === 'text') {
      const textarea = document.querySelector(`.question[data-qid="${q.id}"] .answer-input`);
      if (textarea?.value.trim() && !answers[q.id]) {
        answers[q.id] = { value: textarea.value.trim(), timestamp: Date.now() };
      }
    }
  });
}

function updateNavigation() {
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const submitBtn = document.getElementById('submit-btn');
  prevBtn.disabled = currentSectionIndex === 0;
  if (currentSectionIndex === schema.sections.length - 1) {
    nextBtn.style.display = 'none';
    submitBtn.style.display = 'inline-block';
  } else {
    nextBtn.style.display = 'inline-block';
    submitBtn.style.display = 'none';
  }
}

function updateProgress() {
  const totalQuestions = schema.sections.reduce((sum, s) => sum + s.questions.length, 0);
  const answeredQuestions = Object.keys(answers).length;
  const percent = Math.round(answeredQuestions / totalQuestions * 100);
  document.getElementById('progress-fill').style.width = `${percent}%`;
  document.getElementById('progress-text').textContent = `${percent}%`;
}

// === АВТО-ПРОВЕРКА ТЕКСТОВЫХ ОТВЕТОВ ===
function checkTextAnswer(question, userAnswer) {
  if (!question.autoCheckKeywords || !userAnswer) return null;
  
  const answerLower = userAnswer.toLowerCase();
  const matched = question.autoCheckKeywords.filter(kw => answerLower.includes(kw.toLowerCase()));
  const matchRatio = matched.length / question.autoCheckKeywords.length;
  
  if (matchRatio >= 0.6) {
    return { earned: question.points, feedback: '✅ Ключевые элементы присутствуют' };
  } else if (matchRatio >= 0.3) {
    return { earned: Math.round(question.points * 0.5), feedback: '⚠️ Частично соответствует: не все ключевые элементы' };
  } else {
    return { earned: 0, feedback: '❌ Не хватает ключевых элементов стандарта' };
  }
}

// === ОТПРАВКА И ПОДСЧЁТ ===
async function handleSubmit() {
  saveCurrentSectionAnswers();
  if (!confirm('Завершить аттестацию? Изменить ответы будет нельзя.')) return;
  
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Отправка...';
  
  // Подсчёт авто-баллов
  let autoScore = 0, maxAutoScore = 0;
  autoScoreDetails = {};
  
  schema.sections.forEach(section => {
    section.questions.forEach(q => {
      if (['single', 'truefalse'].includes(q.type)) {
        maxAutoScore += q.points;
        const userAnswer = answers[q.id]?.value;
        const correct = q.type === 'truefalse' ? q.correctAnswer : q.options?.find(o => o.correct)?.id;
        if (userAnswer === correct) {
          autoScore += q.points;
          autoScoreDetails[q.id] = { earned: q.points, max: q.points, feedback: '✅ Верно' };
        } else {
          autoScoreDetails[q.id] = { earned: 0, max: q.points, feedback: q.explanation ? `❌ ${q.explanation}` : '❌ Неверно' };
        }
      } else if (q.type === 'multi') {
        maxAutoScore += q.points;
        const userAnswers = answers[q.id]?.value || [];
        const correctAnswers = q.options?.filter(o => o.correct).map(o => o.id) || [];
        const isFullyCorrect = userAnswers.length === correctAnswers.length && userAnswers.every(a => correctAnswers.includes(a));
        if (isFullyCorrect) {
          autoScore += q.points;
          autoScoreDetails[q.id] = { earned: q.points, max: q.points, feedback: '✅ Все варианты верны' };
        } else {
          const partial = userAnswers.filter(a => correctAnswers.includes(a)).length;
          const earned = Math.round(q.points * partial / correctAnswers.length);
          autoScore += earned;
          autoScoreDetails[q.id] = { earned, max: q.points, feedback: `⚠️ Верно ${partial} из ${correctAnswers.length}` };
        }
      } else if (q.type === 'text' && q.autoCheckKeywords) {
        maxAutoScore += q.points;
        const result = checkTextAnswer(q, answers[q.id]?.value);
        if (result) {
          autoScore += result.earned;
          autoScoreDetails[q.id] = { ...result, max: q.points };
        }
      }
    });
  });
  
  try {
    const response = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: currentUser.name,
        position: currentUser.position,
        answers,
        autoScoreDetails
      })
    });
    const result = await response.json();
    if (result.success) {
      showResult(result, autoScore, maxAutoScore);
    } else {
      throw new Error(result.error || 'Ошибка отправки');
    }
  } catch (err) {
    console.error(err);
    alert('❌ Не удалось отправить результаты. Попробуйте ещё раз.');
    submitBtn.disabled = false;
    submitBtn.textContent = '✅ Завершить';
  }
}

function showResult(apiResult, autoScore, maxAutoScore) {
  showScreen('result');
  const percentage = maxAutoScore > 0 ? Math.round(autoScore / maxAutoScore * 100) : 0;
  
  document.getElementById('score-value').textContent = autoScore;
  document.getElementById('score-max').textContent = maxAutoScore;
  
  const badge = document.getElementById('result-badge');
  const message = document.getElementById('result-message');
  
  if (percentage >= schema.meta.passingScore) {
    badge.textContent = '✅ Пройдено';
    badge.className = 'badge passed';
    message.textContent = percentage >= schema.meta.excellentScore 
      ? '🌟 Отличный результат! Вы глубоко знаете стандарт.' 
      : 'Поздравляем! Вы успешно прошли аттестацию.';
    document.getElementById('result-title').textContent = '🎉 Аттестация пройдена!';
  } else {
    badge.textContent = '📋 На проверке';
    badge.className = 'badge pending';
    message.textContent = 'Открытые вопросы отправлены аттестатору. Ожидайте обратной связи.';
  }
  
  // Детализация
  const detailsEl = document.getElementById('result-details');
  const textQuestions = Object.entries(answers).filter(([qid]) => {
    const q = schema.sections.flatMap(s => s.questions).find(q => q.id === qid);
    return q?.type === 'text' && !q.autoCheckKeywords;
  });
  
  detailsEl.innerHTML = `
    <h4>📊 Детализация:</h4>
    <div class="result-item ${autoScore >= schema.meta.passingScore ? 'correct' : 'pending'}">
      <strong>Автоматические вопросы:</strong> ${autoScore} / ${maxAutoScore} баллов (${percentage}%)
    </div>
    <div class="result-item pending">
      <strong>Открытые вопросы на ручной проверке:</strong> ${textQuestions.length}
    </div>
    <div class="result-item">
      <strong>Дата:</strong> ${new Date().toLocaleDateString('ru-RU')}
    </div>
    ${Object.entries(autoScoreDetails).slice(0, 5).map(([qid, detail]) => {
      const q = schema.sections.flatMap(s => s.questions).find(q => q.id === qid);
      return `<div class="result-item ${detail.earned === detail.max ? 'correct' : detail.earned > 0 ? 'pending' : 'incorrect'}">
        <strong>${q?.text?.slice(0, 60)}${q?.text?.length > 60 ? '...' : ''}</strong><br>
        ${detail.feedback} (${detail.earned}/${detail.max})
      </div>`;
    }).join('')}
  `;
}

function handleRestart() {
  if (confirm('Начать аттестацию заново? Текущие ответы будут удалены.')) {
    answers = {};
    autoScoreDetails = {};
    currentSectionIndex = 0;
    showScreen('login');
    document.getElementById('login-form').reset();
  }
}
