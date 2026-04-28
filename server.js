import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ASSESSOR_PASS = process.env.ASSESSOR_PASS || "HostessCheck2024";

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

const resultsDir = join(__dirname, 'results');
if (!existsSync(resultsDir)) mkdirSync(resultsDir);

// 📥 Схема теста (без правильных ответов)
app.get('/api/schema', (req, res) => {
  const safe = JSON.parse(JSON.stringify(questionsData));
  safe.sections.forEach(s => s.questions.forEach(q => {
    delete q.correctAnswer;
    if (q.options) q.options = q.options.map(o => { const { correct, ...r } = o; return r; });
  }));
  res.json(safe);
});

// 📤 Отправка + авто-подсчёт
app.post('/api/submit', (req, res) => {
  const { userName, position, answers } = req.body;
  if (!userName || !answers) return res.status(400).json({ error: 'Missing fields' });

  let autoScore = 0, maxAuto = 0;
  const details = {};

  questionsData.sections.forEach(sec => {
    sec.questions.forEach(q => {
      const user = answers[q.id]?.value;
      if (q.type === 'single' || q.type === 'truefalse') {
        maxAuto += q.points;
        const correct = q.type === 'truefalse' ? q.correctAnswer : q.options?.find(o => o.correct)?.id;
        const ok = user === correct;
        if (ok) autoScore += q.points;
        details[q.id] = { earned: ok ? q.points : 0, max: q.points, feedback: ok ? '✅ Верно' : (q.explanation || '❌ Неверно') };
      } else if (q.type === 'multi') {
        maxAuto += q.points;
        const u = Array.isArray(user) ? user : [];
        const c = q.options?.filter(o => o.correct).map(o => o.id) || [];
        const ok = u.length === c.length && u.every(v => c.includes(v));
        autoScore += ok ? q.points : 0;
        details[q.id] = { earned: ok ? q.points : 0, max: q.points, feedback: ok ? '✅ Все верно' : '⚠️ Есть ошибки' };
      } else if (q.type === 'text' && q.autoCheckKeywords) {
        maxAuto += q.points;
        const txt = (user || '').toLowerCase();
        const match = q.autoCheckKeywords.filter(k => txt.includes(k.toLowerCase()));
        const ratio = match.length / q.autoCheckKeywords.length;
        let earned = 0, fb = '❌ Не хватает ключевых элементов';
        if (ratio >= 0.6) { earned = q.points; fb = '✅ Ключевые элементы присутствуют'; }
        else if (ratio >= 0.3) { earned = Math.round(q.points * 0.5); fb = '⚠️ Частично соответствует'; }
        autoScore += earned;
        details[q.id] = { earned, max: q.points, feedback: fb };
      }
    });
  });

  const pct = maxAuto > 0 ? Math.round((autoScore / maxAuto) * 100) : 0;
  const result = {
    id: Date.now().toString(),
    submittedAt: new Date().toISOString(),
    userName, position, answers,
    autoScore: { total: autoScore, max: maxAuto, percentage: pct },
    autoScoreDetails: details,
    status: pct >= questionsData.meta.passingScore ? 'passed_auto' : 'pending_review'
  };

  writeFileSync(join(resultsDir, `result_${result.id}.json`), JSON.stringify(result, null, 2), 'utf-8');
  console.log(`✅ Saved: result_${result.id}.json`);
  res.json({ success: true, resultId: result.id, score: result.autoScore });
});

// 📊 Результат для проверки
app.get('/api/result/:id', (req, res) => {
  const path = join(resultsDir, `result_${req.params.id}.json`);
  try {
    const r = JSON.parse(readFileSync(path, 'utf-8'));
    r.questionsWithAnswers = questionsData.sections.flatMap(s => s.questions.map(q => ({
      id: q.id, text: q.text, type: q.type, points: q.points,
      correctAnswer: q.type === 'truefalse' ? q.correctAnswer : q.options?.find(o => o.correct)?.id,
      userAnswer: r.answers[q.id]?.value, criteria: q.criteria
    })));
    res.json(r);
  } catch { res.status(404).json({ error: 'Not found' }); }
});

// 🔒 Панель аттестатора
app.get('/review', (req, res) => {
  if (req.query.pass !== ASSESSOR_PASS) {
    return res.status(401).type('html').send(`
      <div style="font-family:Arial;text-align:center;padding:3rem;background:#f9f6ee;border-radius:12px;max-width:400px;margin:3rem auto;">
        <h2>🔒 Доступ закрыт</h2><p>Только для аттестаторов.</p>
        <p>Пример ссылки: <code>/review?pass=${ASSESSOR_PASS}</code></p>
      </div>`);
  }
  res.sendFile(join(__dirname, 'public', 'review.html'));
});

app.post('/api/review/:id', (req, res) => {
  if ((req.query.pass || req.headers['x-assessor-pass']) !== ASSESSOR_PASS) return res.status(401).json({ error: 'Unauthorized' });
  const { criteriaScores, comments } = req.body;
  const path = join(resultsDir, `result_${req.params.id}.json`);
  try {
    const r = JSON.parse(readFileSync(path, 'utf-8'));
    r.manualReview = { criteriaScores, comments, reviewedAt: new Date().toISOString() };
    writeFileSync(path, JSON.stringify(r, null, 2), 'utf-8');
    res.json({ success: true });
  } catch { res.status(404).json({ error: 'Not found' }); }
});

app.listen(PORT, () => {
  console.log(`🌐 Server: http://localhost:${PORT}`);
  console.log(`🔑 Assessor: http://localhost:${PORT}/review?pass=${ASSESSOR_PASS}`);
});
