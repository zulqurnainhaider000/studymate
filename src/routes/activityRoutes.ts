import { Router } from 'express';
import { getRecent } from '../controllers/activityController.js';

export const activityRouter = Router();
activityRouter.get('/', getRecent);
activityRouter.get('/recent', getRecent);

