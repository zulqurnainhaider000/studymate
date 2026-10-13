import { Router } from 'express';
import { getProfile } from '../controllers/profileController.js';
import { changePassword } from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';
import { changePasswordSchema } from '../schemas/authSchemas.js';

export const profileRouter = Router();
profileRouter.get('/', getProfile);
profileRouter.put('/change-password', validate(changePasswordSchema), changePassword);
profileRouter.put('/password', validate(changePasswordSchema), changePassword);
