import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Загрузка вопросов
const questionsPath = join(__dirname, 'data', 'questions.json');
const questionsData = JSON.parse(readFileSync(questionsPath, 'utf-8'));

// 📥 API: получить схему теста
app.get('/api/schema', (req, res) => {
  // Отдаём вопросы без правильных ответов для безопасности
  const safeQuestions = {
    ...questionsData,
    sections: questionsData.sections.map(section => ({
      ...section,
      questions: section.questions.map(q => {
        const { correct, correctAnswer, ...rest } = q;
        if (rest.options) {
          rest.options = rest.options.map(({ correct, ...opt }) => opt);
        }
        return rest;
      })
    }))
  };
  res.json(safeQuestions);
});

// 📤 API: сохранить результаты
app.post('/api/submit', (req, res) => {
  const { userName, position, answers } = req.body;
  
  if (!userName || !answers) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Автоматический подсчёт баллов
  let autoScore = 0;
  let maxAutoScore = 0;
  
  questionsData.sections.forEach(section => {
    section.questions.forEach(q => {
      if (q.type === 'single' || q.type === 'truefalse') {
        maxAutoScore += q.points;
        const userAnswer = answers[q.id]?.value;
        const correct = q.type === 'truefalse' 
          ? q.correctAnswer 
          : q.options?.find(o => o.correct)?.id;
        
        if (userAnswer === correct) {
          autoScore += q.points;
        }
      } else if (q.type === 'multi') {
        maxAutoScore += q.points;
        const userAnswers = answers[q.id]?.value || [];
        const correctAnswers = q.options?.filter(o => o.correct).map(o => o.id) || [];
        
        const isFullyCorrect = 
          userAnswers.length === correctAnswers.length &&
          userAnswers.every(a => correctAnswers.includes(a));
        
        if (isFullyCorrect) {
          autoScore += q.points;
        }
      }
      // text-вопросы оцениваются вручную позже
    });
  });
  
  const result = {
    id: Date.now().toString(),
    submittedAt: new Date().toISOString(),
    userName,
    position,
    answers,
    autoScore: {
      total: autoScore,
      max: maxAutoScore,
      percentage: maxAutoScore > 0 ? Math.round(autoScore / maxAutoScore * 100) : 0
    },
    status: autoScore >= questionsData.meta.passingScore ? 'passed_auto' : 'pending_review'
  };
  
  // Сохраняем в файл (в продакшене — в БД)
  const resultsDir = join(__dirname, 'results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir);
  
  const filePath = join(resultsDir, `result_${result.id}.json`);
  writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
  
  console.log(`✅ Результат сохранён: ${filePath}`);
  
  res.json({
    success: true,
    resultId: result.id,
    score: result.autoScore,
    passingScore: questionsData.meta.passingScore,
    message: result.autoScore.percentage >= questionsData.meta.passingScore 
      ? '🎉 Аттестация пройдена!' 
      : '📋 Требуется проверка аттестатором'
  });
});

// 📊 API: получить результат по ID (для аттестатора)
app.get('/api/result/:id', (req, res) => {
  const filePath = join(__dirname, 'results', `result_${req.params.id}.json`);
  try {
    const result = JSON.parse(readFileSync(filePath, 'utf-8'));
    // Добавляем правильные ответы для проверки
    result.questionsWithAnswers = questionsData.sections.flatMap(s => 
      s.questions.map(q => ({
        id: q.id,
        text: q.text,
        type: q.type,
        points: q.points,
        correctAnswer: q.type === 'truefalse' ? q.correctAnswer : q.options?.find(o => o.correct)?.id,
        correctOptions: q.options?.filter(o => o.correct).map(o => o.id),
        userAnswer: result.answers[q.id]?.value,
        criteria: q.criteria
      }))
    );
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: 'Result not found' });
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
  console.log(`📋 Тест доступен по адресу: http://localhost:${PORT}`);
});