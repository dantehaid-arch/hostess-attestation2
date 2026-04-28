import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ESM-совместимый __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 Пароль для панели аттестатора (можно переопределить через .env или переменную окружения Render)
const ASSESSOR_PASS = process.env.ASSESSOR_PASS || "HostessCheck2024";

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Загрузка вопросов
const questionsPath = join(__dirname, 'data', 'questions.json');
let questionsData = {};
try {
  questionsData = JSON.parse(readFileSync(questionsPath, 'utf-8'));
} catch (err) {
  console.error('❌ Ошибка загрузки questions.json:', err.message);
  process.exit(1);
}

// Создание папки результатов
const resultsDir = join(__dirname, 'results');
if (!existsSync(resultsDir)) mkdirSync(resultsDir);

// 📥 API: Получить схему теста (без правильных ответов)
app.get('/api/schema', (req, res) => {
  const safeData = JSON.parse(JSON.stringify(questionsData)); // глубокая копия
  safeData.sections.forEach(section => {
    section.questions.forEach(q => {
      delete q.correctAnswer; // скрываем правильные ответы
      if (q.options) {
        q.options = q.options.map(opt => {
          const { correct, ...rest } = opt;
          return rest;
        });
      }
    });
  });
  res.json(safeData);
});

// 📤 API: Сохранить результаты + авто-подсчёт баллов
app.post('/api/submit', (req, res) => {
  const { userName, position, answers } = req.body;
  if (!userName || !answers) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let autoScore = 0;
  let maxAutoScore = 0;
  const autoScoreDetails = {};

  questionsData.sections.forEach(section => {
    section.questions.forEach(q => {
      const userAnswer = answers[q.id]?.value;

      if (q.type === 'single' || q.type === 'truefalse') {
        maxAutoScore += q.points;
        const correct = q.type === 'truefalse' ? q.correctAnswer : q.options?.find(o => o.correct)?.id;
        const isCorrect = userAnswer === correct;
        if (isCorrect) autoScore += q.points;
        autoScoreDetails[q.id] = {
          earned: isCorrect ? q.points : 0,
          max: q.points,
          feedback: isCorrect ? '✅ Верно' : (q.explanation ? `❌ ${q.explanation}` : '❌ Неверно')
        };
      } 
      else if (q.type === 'multi') {
        maxAutoScore += q.points;
        const userVals = Array.isArray(userAnswer) ? userAnswer : [];
        const correctVals = q.options?.filter(o => o.correct).map(o => o.id) || [];
        const isFullyCorrect = userVals.length === correctVals.length && userVals.every(v => correctVals.includes(v));
        const earned = isFullyCorrect ? q.points : 0;
        autoScore += earned;
        autoScoreDetails[q.id] = { earned, max: q.points, feedback: isFullyCorrect ? '✅ Все верно' : '⚠️ Есть ошибки' };
      } 
      else if (q.type === 'text' && q.autoCheckKeywords) {
        maxAutoScore += q.points;
        const text = (userAnswer || '').toLowerCase();
        const matched = q.autoCheckKeywords.filter(kw => text.includes(kw.toLowerCase()));
        const ratio = matched.length / q.autoCheckKeywords.length;
        let earned = 0, feedback = '❌ Не хватает ключевых элементов';
        
        if (ratio >= 0.6) { earned = q.points; feedback = '✅ Ключевые элементы присутствуют'; }
        else if (ratio >= 0.3) { earned = Math.round(q.points * 0.5); feedback = '⚠️ Частично соответствует'; }
        
        autoScore += earned;
        autoScoreDetails[q.id] = { earned, max: q.points, feedback };
      }
    });
  });

  const percentage = maxAutoScore > 0 ? Math.round((autoScore / maxAutoScore) * 100) : 0;

  const result = {
    id: Date.now().toString(),
    submittedAt: new Date().toISOString(),
    userName,
    position,
    answers,
    autoScore: { total: autoScore, max: maxAutoScore, percentage },
    autoScoreDetails,
    status: percentage >= questionsData.meta.passingScore ? 'passed_auto' : 'pending_review'
  };

  const filePath = join(resultsDir, `result_${result.id}.json`);
  writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`✅ Результат сохранён: ${filePath}`);

  res.json({ success: true, resultId: result.id, score: result.autoScore });
});

// 📊 API: Получить результат для проверки (только для аттестатора)
app.get('/api/result/:id', (req, res) => {
  const filePath = join(resultsDir, `result_${req.params.id}.json`);
  try {
    const result = JSON.parse(readFileSync(filePath, 'utf-8'));
    result.questionsWithAnswers = questionsData.sections.flatMap(s =>
      s.questions.map(q => ({
        id: q.id, text: q.text, type: q.type, points: q.points,
        correctAnswer: q.type === 'truefalse' ? q.correctAnswer : q.options?.find(o => o.correct)?.id,
        correctOptions: q.options?.filter(o => o.correct).map(o => o.id),
        userAnswer: result.answers[q.id]?.value,
        criteria: q.criteria,
        autoCheckKeywords: q.autoCheckKeywords
      }))
    );
    res.json(result);
  } catch {
    res.status(404).json({ error: 'Result not found' });
  }
});

// 🔒 Панель аттестатора (защищена паролем)
app.get('/review', (req, res) => {
  const { pass } = req.query;
  if (pass !== ASSESSOR_PASS) {
    return res.status(401).type('html').send(`
      <div style="font-family:Arial;text-align:center;padding:3rem;background:#f9f6ee;border-radius:12px;max-width:400px;margin:2rem auto;">
        <h2>🔒 Доступ закрыт</h2>
        <p>Панель аттестатора доступна только по ссылке с паролем.</p>
        <p><strong>Пример:</strong> <code>/review?pass=${ASSESSOR_PASS}</code></p>
      </div>
    `);
  }
  res.sendFile(join(__dirname, 'public', 'review.html'));
});

// 💾 Сохранение ручной оценки аттестатора
app.post('/api/review/:id', (req, res) => {
  const queryPass = req.query.pass;
  const headerPass = req.headers['x-assessor-pass'];
  if (queryPass !== ASSESSOR_PASS && headerPass !== ASSESSOR_PASS) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { criteriaScores, comments } = req.body;
  const filePath = join(resultsDir, `result_${req.params.id}.json`);
  try {
    const result = JSON.parse(readFileSync(filePath, 'utf-8'));
    result.manualReview = { criteriaScores, comments, reviewedAt: new Date().toISOString() };
    writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Result not found' });
  }
});

// 🚀 Запуск сервера
app.listen(PORT, () => {
  console.log(`🌐 Сервер запущен: http://localhost:${PORT}`);
  console.log(`🔑 Ссылка для аттестатора: http://localhost:${PORT}/review?pass=${ASSESSOR_PASS}`);
  console.log(`📊 Проходной балл: ${questionsData.meta.passingScore} из ${questionsData.meta.totalPoints}`);
});
