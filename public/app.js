// Глобальные переменные
let schema = null;
let currentUser = null;
let answers = {};
let currentSectionIndex = 0;

// DOM элементы
const screens = {
  login: document.getElementById('login-screen'),
  test: document.getElementById('test-screen'),
  result: document.getElementById('result-screen')
};

// === ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', async () => {
  // Загрузка схемы вопросов
  try {
    const response = await fetch('/api/schema');
    schema = await response.json();
    document.title = schema.meta.title;
  } catch (err) {
    alert('❌ Не удалось загрузить тест. Проверьте соединение с сервером.');
    console.error(err);
  }
  
  // Обработчики кнопок
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
  
  switch (q.type) {
    case 'single':
      return `
        <div class="question" data-qid="${q.id}">
          <p class="question-text">${q.text} <span class="question-points">[${pointsText}]</span></p>
          <div class="options">
            ${q.options.map(opt => `
              <label class="option">
                <input type="radio" name="${q.id}" value="${opt.id}">
                <span>${opt.text}</span>
              </label>
            `).join('')}
          </div>
        </div>
      `;
      
    case 'multi':
      return `
        <div class="question" data-qid="${q.id}">
          <p class="question-text">${q.text} <span class="question-points">[${pointsText}]</span></p>
          <div class="options">
            ${q.options.map(opt => `
              <label class="option checkbox">
                <input type="checkbox" name="${q.id}" value="${opt.id}">
                <span>${opt.text}</span>
              </label>
            `).join('')}
          </div>
          <p class="hint">* Отметьте все подходящие варианты</p>
        </div>
      `;
      
    case 'truefalse':
      const currentValue = answers[q.id]?.value;
      return `
        <div class="question" data-qid="${q.id}">
          <p class="question-text">${q.text} <span class="question-points">[${pointsText}]</span></p>
          <div class="tf-options">
            <button type="button" class="tf-btn ${currentValue === true ? 'selected correct' : ''}" 
                    data-value="true">☑ ВЕРНО</button>
            <button type="button" class="tf-btn ${currentValue === false ? 'selected incorrect' : ''}" 
                    data-value="false">☑ НЕВЕРНО</button>
          </div>
        </div>
      `;
      
    case 'text':
      return `
        <div class="question" data-qid="${q.id}">
          <p class="question-text">${q.text} <span class="question-points">[${pointsText}]</span></p>
          ${q.subtype === 'case' ? `<div class="scenario-box"><strong>СИТУАЦИЯ:</strong> ${q.situation}</div>` : ''}
          <textarea class="answer-input" placeholder="${q.placeholder || 'Ваш ответ...'}">${answers[q.id]?.value || ''}</textarea>
          ${q.criteria ? `
            <div class="criteria-preview">
              <small>📋 На что обратит внимание аттестатор:</small>
              <ul>${q.criteria.map(c => `<li>${c}</li>`).join('')}</ul>
            </div>
          ` : ''}
        </div>
      `;
      
    default:
      return '';
  }
}

// === ОБРАБОТЧИКИ СОБЫТИЙ ===
function attachEventListeners() {
  // Radio и checkbox
  document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', (e) => {
      const qid = e.target.name;
      const type = schema.sections.flatMap(s => s.questions).find(q => q.id === qid)?.type;
      
      if (type === 'single') {
        answers[qid] = { value: e.target.value, timestamp: Date.now() };
      } else if (type === 'multi') {
        const checked = document.querySelectorAll(`input[name="${qid}"]:checked`);
        answers[qid] = { 
          value: Array.from(checked).map(c => c.value), 
          timestamp: Date.now() 
        };
      }
      updateProgress();
    });
  });
  
  // True/False кнопки
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const questionEl = e.target.closest('.question');
      const qid = questionEl.dataset.qid;
      const value = e.target.dataset.value === 'true';
      
      // Визуальное выделение
      questionEl.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('selected'));
      e.target.classList.add('selected');
      
      answers[qid] = { value, timestamp: Date.now() };
      updateProgress();
    });
  });
  
  // Текстовые поля
  document.querySelectorAll('.answer-input').forEach(textarea => {
    textarea.addEventListener('input', (e) => {
      const qid = e.target.closest('.question').dataset.qid;
      answers[qid] = { value: e.target.value, timestamp: Date.now() };
      updateProgress();
    });
  });
}

function navigateSection(direction) {
  // Сохраняем текущие ответы перед переходом
  saveCurrentSectionAnswers();
  
  const newIndex = currentSectionIndex + direction;
  if (newIndex < 0 || newIndex >= schema.sections.length) return;
  
  // Скрываем текущий раздел, показываем новый
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
        answers[q.id] = { 
          value: Array.from(checked).map(c => c.value), 
          timestamp: Date.now() 
        };
      }
    } else if (q.type === 'text') {
      const textarea = document.querySelector(`.question[data-qid="${q.id}"] .answer-input`);
      if (textarea?.value && !answers[q.id]) {
        answers[q.id] = { value: textarea.value, timestamp: Date.now() };
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

// === ОТПРАВКА ===
async function handleSubmit() {
  saveCurrentSectionAnswers();
  
  if (!confirm('Завершить аттестацию? Изменить ответы будет нельзя.')) {
    return;
  }
  
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Отправка...';
  
  try {
    const response = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: currentUser.name,
        position: currentUser.position,
        answers
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      showResult(result);
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

function showResult(apiResult) {
  showScreen('result');
  
  const { score, passingScore } = apiResult;
  const percentage = score.percentage;
  
  // Отображение счёта
  document.getElementById('score-value').textContent = score.total;
  document.getElementById('score-max').textContent = score.max;
  
  // Бейдж результата
  const badge = document.getElementById('result-badge');
  const message = document.getElementById('result-message');
  
  if (percentage >= passingScore) {
    badge.textContent = '✅ Пройдено';
    badge.className = 'badge passed';
    message.textContent = 'Поздравляем! Вы успешно прошли аттестацию.';
    document.getElementById('result-title').textContent = '🎉 Аттестация пройдена!';
  } else {
    badge.textContent = '📋 На проверке';
    badge.className = 'badge pending';
    message.textContent = 'Открытые вопросы отправлены аттестатору. Ожидайте обратной связи.';
  }
  
  // Детали
  const detailsEl = document.getElementById('result-details');
  detailsEl.innerHTML = `
    <h4>📊 Детализация:</h4>
    <div class="result-item">
      <strong>Автоматические вопросы:</strong> ${score.total} / ${score.max} баллов
    </div>
    <div class="result-item">
      <strong>Открытые вопросы:</strong> ${Object.values(answers).filter(a => 
        schema.sections.flatMap(s => s.questions).find(q => q.id === a.questionId)?.type === 'text'
      ).length} на ручной проверке
    </div>
    <div class="result-item">
      <strong>Дата:</strong> ${new Date().toLocaleDateString('ru-RU')}
    </div>
  `;
}

function handleRestart() {
  if (confirm('Начать аттестацию заново? Текущие ответы будут удалены.')) {
    answers = {};
    currentSectionIndex = 0;
    showScreen('login');
    document.getElementById('login-form').reset();
  }
}