import type { NextFunction, Request, Response } from 'express';
import { query } from '../config/database.js';
import { HttpError } from '../middleware/error-handler.js';

type TaskBody = { title: string; description?: string; dueAt?: string; priority?: 'low' | 'medium' | 'high' };
type TaskRow = { id: string; title: string; description: string | null; due_at: string | null; status: string; priority: string; completed_at: string | null };
const mapTask = (task: TaskRow) => ({ id: task.id, title: task.title, description: task.description, dueAt: task.due_at, status: task.status, priority: task.priority, completedAt: task.completed_at });

export const listTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try { if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required'); const result = await query<TaskRow>('SELECT id, title, description, due_at, status, priority, completed_at FROM study_tasks WHERE user_id = $1 ORDER BY due_at NULLS LAST, created_at DESC', [req.user.id]); res.json({ tasks: result.rows.map(mapTask) }); } catch (error) { next(error); }
};
export const createTask = async (req: Request<unknown, unknown, TaskBody>, res: Response, next: NextFunction): Promise<void> => {
  try { if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required'); const result = await query<TaskRow>('INSERT INTO study_tasks (user_id, title, description, due_at, priority) VALUES ($1, $2, $3, $4, $5) RETURNING id, title, description, due_at, status, priority, completed_at', [req.user.id, req.body.title, req.body.description ?? null, req.body.dueAt ?? null, req.body.priority ?? 'medium']); const task = result.rows[0]; if (!task) throw new Error('Task creation returned no row'); res.status(201).json({ task: mapTask(task) }); } catch (error) { next(error); }
};
export const updateTask = async (req: Request<{ id: string }, unknown, Partial<TaskBody> & { status?: 'todo' | 'in_progress' | 'completed' | 'canceled' }>, res: Response, next: NextFunction): Promise<void> => {
  try { if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required'); const result = await query<TaskRow>('UPDATE study_tasks SET title = COALESCE($1, title), description = COALESCE($2, description), due_at = COALESCE($3, due_at), priority = COALESCE($4, priority), status = COALESCE($5, status), completed_at = CASE WHEN $5 = \'completed\' THEN now() ELSE completed_at END WHERE id = $6 AND user_id = $7 RETURNING id, title, description, due_at, status, priority, completed_at', [req.body.title ?? null, req.body.description ?? null, req.body.dueAt ?? null, req.body.priority ?? null, req.body.status ?? null, req.params.id, req.user.id]); const task = result.rows[0]; if (!task) throw new HttpError(404, 'TASK_NOT_FOUND', 'Task not found'); res.json({ task: mapTask(task) }); } catch (error) { next(error); }
};
export const deleteTask = async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
  try { if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required'); const result = await query('DELETE FROM study_tasks WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]); if (result.rowCount === 0) throw new HttpError(404, 'TASK_NOT_FOUND', 'Task not found'); res.status(204).send(); } catch (error) { next(error); }
};
