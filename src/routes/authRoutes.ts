import { Router } from 'express';
import { register, login, changePassword, verifyOtp, resendOtp } from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  verifyOtpSchema,
  resendOtpSchema,
} from '../schemas/authSchemas.js';
import { authenticateToken } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.post('/register', validate(registerSchema), register);
authRouter.post('/verify-otp', validate(verifyOtpSchema), verifyOtp);
authRouter.post('/resend-otp', validate(resendOtpSchema), resendOtp);
authRouter.post('/login', validate(loginSchema), login);
authRouter.put('/change-password', authenticateToken, validate(changePasswordSchema), changePassword);
authRouter.post('/change-password', authenticateToken, validate(changePasswordSchema), changePassword);
