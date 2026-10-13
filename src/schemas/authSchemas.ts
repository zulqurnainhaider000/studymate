import { z } from 'zod';

const emptyObject = z.object({});

export const registerSchema = z.object({
  body: z.object({
    email: z.email().transform((email) => email.toLowerCase()),
    password: z.string().min(8).max(128),
    displayName: z.string().trim().min(1).max(100),
    educationLevel: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  }),
  params: emptyObject,
  query: emptyObject,
});

export const loginSchema = z.object({
  body: z.object({
    email: z.email().transform((email) => email.toLowerCase()),
    password: z.string().min(1).max(128),
  }),
  params: emptyObject,
  query: emptyObject,
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required').max(128),
    newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128),
    confirmPassword: z.string().min(1).max(128).optional(),
  }),
  params: emptyObject,
  query: emptyObject,
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>['body'];
