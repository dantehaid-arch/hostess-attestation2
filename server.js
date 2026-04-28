import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ASSESSOR_PASS = process.env.ASSESSOR_PASS || "123123";
const TG_TOKEN = process.env.TG_TOKEN || '';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const qPath = join(__dirname, 'data', 'questions.json');
let questions = {};
try { questions = JSON.parse(readFileSync(qPath, 'utf-8')); } 
catch (e) { console.error('❌ questions.json не найден'); process.exit(1); }

const resDir = join(__dirname, 'results');
if (!existsSync(resDir)) mkdirSync(resDir);

// 📥 Безопасная схема для сотрудников
app.get('/api/schema', (req, res) => {
  const safe = JSON.parse(JSON.stringify(questions));
  safe.sections.forEach(s => s.questions.forEach(q => {
    delete q.correctAnswer; delete q.autoCheckKeywords; delete q.explanation;
    if (q.options) q.options = q.options.map(o => { const { correct, ...r } = o; return r; });
  }));
  res.json(safe);
});

// 🔍 Полная схема для аттестатора (с правильными ответами)
app.get('/api/schema-full', (req, res) => {
  if (req.query.pass !== ASSESSOR_PASS) return res.status(401).json({ error: 'Unauthorized' });
  res.json(questions);
});

// 🔔 Уведомление в Telegram
async function notifyAttestator(result) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    const text = `📝 *Новая аттестация*\n` +
                 `👤 *ФИО:* ${result.userName}\n` +
                 `💼 *Должность:* ${result.position}\n` +
                 `📊 *Авто-балл:* ${result.autoScore.total}/${result.autoScore.max} (${result.autoScore.percentage}%)\n` +
                 `🆔 *ID:* \`${result.id}\`\n` +
                 `🔗 *Проверка:* ${process.env.RENDER_EXTERNAL_URL || 'https://ваш-сайт.onrender.com'}/review?pass=${ASSESSOR_PASS}&id=${result.id}`;
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'Markdown' })
    });
  } catch (err) { console.error('❌ TG error:', err.message); }
}

// 📤 Отправка + авто-подсчёт
app.post('/api/submit', async (req, res) => {
  const { userName, position, answers } = req.body;
  if (!userName || !answers) return res.status(400).json({ error: 'Missing fields' });

  let auto = 0, max = 0;
  const details = {};

  questions.sections.forEach(sec => sec.questions.forEach(q => {
    const u = answers[q.id]?.value;
    if (q.type === 'single' || q.type === 'truefalse') {
      max += q.points;
      const c = q.type === 'truefalse' ? q.correctAnswer : q.options?.find(o => o.correct)?.id;
      const ok = u === c;
      if (ok) auto += q.points;
      details[q.id] = { earned: ok ? q.points : 0, max: q.points, feedback: ok ? '✅ Верно' : '❌ Неверно' };
    } else if (q.type === 'multi') {
      max += q.points;
      const ua = Array.isArray(u) ? u : [];
      const ca = q.options?.filter(o => o.correct).map(o => o.id) || [];
      const ok = ua.length === ca.length && ua.every(v => ca.includes(v));
      auto += ok ? q.points : 0;
      details[q.id] = { earned: ok ? q.points : 0, max: q.points, feedback: ok ? '✅ Все верно' : '⚠️ Есть ошибки' };
    } else if (q.type === 'text' && q.autoCheckKeywords) {
      max += q.points;
      const txt = (u || '').toLowerCase();
      const match = q.autoCheckKeywords.filter(k => txt.includes(k.toLowerCase()));
      const ratio = match.length / q.autoCheckKeywords.length;
      let earned = 0, fb = '❌ Не хватает ключевых элементов';
      if (ratio >= 0.6) { earned = q.points; fb = '✅ Ключевые элементы присутствуют'; }
      else if (ratio >= 0.3) { earned = Math.round(q.points * 0.5); fb = '⚠️ Частично соответствует'; }
      auto += earned;
      details[q.id] = { earned, max: q.points, feedback: fb };
    }
  }));

  const pct = max > 0 ? Math.round((auto / max) * 100) : 0;
  const result = {
    id: Date.now().toString(), submittedAt: new Date().toISOString(),
    userName, position, answers,
    autoScore: { total: auto, max, percentage: pct },
    autoScoreDetails: details,
    status: pct >= questions.meta.passingScore ? 'passed_auto' : 'pending_review'
  };

  writeFileSync(join(resDir, `result_${result.id}.json`), JSON.stringify(result, null, 2), 'utf-8');
  notifyAttestator(result).catch(() => {}); 
  res.json({ success: true, resultId: result.id, score: result.autoScore });
});

// 📊 Результат для проверки
app.get('/api/result/:id', (req, res) => {
  const path = join(resDir, `result_${req.params.id}.json`);
  try {
    const r = JSON.parse(readFileSync(path, 'utf-8'));
    r.questionsWithAnswers = questions.sections.flatMap(s => s.questions.map(q => ({
      id: q.id, text: q.text, type: q.type, points: q.points,
      userAnswer: r.answers[q.id]?.value, criteria: q.criteria
    })));
    res.json(r);
  } catch { res.status(404).json({ error: 'Not found' }); }
});

// 🔒 Панель аттестатора
app.get('/review', (req, res) => {
  if (req.query.pass !== ASSESSOR_PASS) return res.status(401).type('html').send(`<h2 style="text-align:center;margin-top:3rem;">🔒 Доступ закрыт</h2><p style="text-align:center">Ссылка: /review?pass=${ASSESSOR_PASS}</p>`);
  res.sendFile(join(__dirname, 'public', 'review.html'));
});

app.post('/api/review/:id', (req, res) => {
  if ((req.query.pass || req.headers['x-assessor-pass']) !== ASSESSOR_PASS) return res.status(401).json({ error: 'Unauthorized' });
  const { criteriaScores, comments } = req.body;
  const path = join(resDir, `result_${req.params.id}.json`);
  try {
    const r = JSON.parse(readFileSync(path, 'utf-8'));
    r.manualReview = { criteriaScores, comments, reviewedAt: new Date().toISOString() };
    writeFileSync(path, JSON.stringify(r, null, 2), 'utf-8');
    res.json({ success: true });
  } catch { res.status(404).json({ error: 'Not found' }); }
});

app.listen(PORT, () => console.log(`🌐 Server: http://localhost:${PORT} | 🔑 Pass: ${ASSESSOR_PASS}`));
