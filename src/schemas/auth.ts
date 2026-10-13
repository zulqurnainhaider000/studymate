import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    email: z.email().transform((value) => value.toLowerCase()),
    password: z.string().min(8).max(128),
    displayName: z.string().trim().min(1).max(100),
  }),
  params: z.object({}),
  query: z.object({}),
});

export const loginSchema = z.object({
  body: z.object({ email: z.email().transform((value) => value.toLowerCase()), password: z.string().min(1).max(128) }),
  params: z.object({}),
  query: z.object({}),
});
