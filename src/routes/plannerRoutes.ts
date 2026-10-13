import { Router } from 'express';
import { z } from 'zod';
import { createTask, deleteTask, listTasks, updateTask } from '../controllers/plannerController.js';
import { validate } from '../middleware/validate.js';

const taskBody = z.object({ title: z.string().trim().min(1).max(200), description: z.string().max(2_000).optional(), dueAt: z.iso.datetime().optional(), priority: z.enum(['low', 'medium', 'high']).optional() });
const createSchema = z.object({ body: taskBody, params: z.object({}), query: z.object({}) });
const updateSchema = z.object({ body: taskBody.partial().extend({ status: z.enum(['todo', 'in_progress', 'completed', 'canceled']).optional() }), params: z.object({ id: z.uuid() }), query: z.object({}) });
const idSchema = z.object({ body: z.unknown().optional(), params: z.object({ id: z.uuid() }), query: z.unknown().optional() });

export const plannerRouter = Router();
plannerRouter.get('/tasks', listTasks);
plannerRouter.post('/tasks', validate(createSchema), createTask);
plannerRouter.put('/tasks/:id', validate(updateSchema), updateTask);
plannerRouter.delete('/tasks/:id', validate(idSchema), deleteTask);
