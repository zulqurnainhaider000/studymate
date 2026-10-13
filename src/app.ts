import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { authenticateToken } from './middleware/auth.js';
import { aiRouter } from './routes/aiRoutes.js';
import { authRouter } from './routes/authRoutes.js';
import { documentRouter } from './routes/documentRoutes.js';
import { healthRouter } from './routes/health.js';
import { quizRouter } from './routes/quizRoutes.js';
import { plannerRouter } from './routes/plannerRoutes.js';
import { profileRouter } from './routes/profileRoutes.js';
import { activityRouter } from './routes/activityRoutes.js';

export const app = express();

app.disable('x-powered-by');
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/ai', authenticateToken, aiRouter);
app.use('/documents', authenticateToken, documentRouter);
app.use('/quiz', authenticateToken, quizRouter);
app.use('/planner', authenticateToken, plannerRouter);
app.use('/profile', authenticateToken, profileRouter);
app.use('/activity', authenticateToken, activityRouter);
app.use('/user/recent-activity', authenticateToken, activityRouter);
app.use(notFoundHandler);
app.use(errorHandler);
