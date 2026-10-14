import { pool, query } from './database.js';

interface Migration {
  id: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    id: '0001_initial',
    sql: `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_plan') THEN
          CREATE TYPE subscription_plan AS ENUM ('free', 'pro', 'team');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
          CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'expired');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_status') THEN
          CREATE TYPE document_status AS ENUM ('pending', 'processing', 'ready', 'failed');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_role') THEN
          CREATE TYPE message_role AS ENUM ('system', 'user', 'assistant');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quiz_difficulty') THEN
          CREATE TYPE quiz_difficulty AS ENUM ('easy', 'medium', 'hard');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
          CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'completed', 'canceled');
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email_verified_at TIMESTAMPTZ,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS profiles (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        bio TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT 'New conversation',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS conversations_user_updated_idx ON conversations(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role message_role NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER CHECK (token_count IS NULL OR token_count >= 0),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes >= 0),
        status document_status NOT NULL DEFAULT 'pending',
        extracted_text TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS documents_user_created_idx ON documents(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS documents_status_idx ON documents(status);

      CREATE TABLE IF NOT EXISTS quizzes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT,
        difficulty quiz_difficulty NOT NULL DEFAULT 'medium',
        question_count INTEGER NOT NULL DEFAULT 0 CHECK (question_count >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS quizzes_user_created_idx ON quizzes(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS quiz_questions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        prompt TEXT NOT NULL,
        options JSONB NOT NULL DEFAULT '[]'::jsonb,
        correct_answer TEXT NOT NULL,
        explanation TEXT,
        UNIQUE (quiz_id, position)
      );
      CREATE INDEX IF NOT EXISTS quiz_questions_quiz_idx ON quiz_questions(quiz_id, position);

      CREATE TABLE IF NOT EXISTS quiz_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        score INTEGER NOT NULL CHECK (score >= 0),
        total_questions INTEGER NOT NULL CHECK (total_questions > 0),
        answers JSONB NOT NULL DEFAULT '{}'::jsonb,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS quiz_results_user_completed_idx ON quiz_results(user_id, completed_at DESC);
      CREATE INDEX IF NOT EXISTS quiz_results_quiz_idx ON quiz_results(quiz_id);

      CREATE TABLE IF NOT EXISTS study_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        status task_status NOT NULL DEFAULT 'todo',
        due_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS study_tasks_user_status_due_idx ON study_tasks(user_id, status, due_at);

      CREATE TABLE IF NOT EXISTS user_xp (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        total_xp BIGINT NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
        current_streak_days INTEGER NOT NULL DEFAULT 0 CHECK (current_streak_days >= 0),
        longest_streak_days INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak_days >= 0),
        level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan subscription_plan NOT NULL DEFAULT 'free',
        status subscription_status NOT NULL DEFAULT 'active',
        provider TEXT,
        provider_customer_id TEXT,
        provider_subscription_id TEXT UNIQUE,
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS subscriptions_user_status_idx ON subscriptions(user_id, status);

      CREATE TABLE IF NOT EXISTS usage_limits (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        period_start DATE NOT NULL DEFAULT CURRENT_DATE,
        messages_used INTEGER NOT NULL DEFAULT 0 CHECK (messages_used >= 0),
        documents_used INTEGER NOT NULL DEFAULT 0 CHECK (documents_used >= 0),
        quizzes_used INTEGER NOT NULL DEFAULT 0 CHECK (quizzes_used >= 0),
        messages_limit INTEGER NOT NULL DEFAULT 50 CHECK (messages_limit >= 0),
        documents_limit INTEGER NOT NULL DEFAULT 5 CHECK (documents_limit >= 0),
        quizzes_limit INTEGER NOT NULL DEFAULT 10 CHECK (quizzes_limit >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'users_set_updated_at') THEN
          CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'profiles_set_updated_at') THEN
          CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'conversations_set_updated_at') THEN
          CREATE TRIGGER conversations_set_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'documents_set_updated_at') THEN
          CREATE TRIGGER documents_set_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'quizzes_set_updated_at') THEN
          CREATE TRIGGER quizzes_set_updated_at BEFORE UPDATE ON quizzes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'study_tasks_set_updated_at') THEN
          CREATE TRIGGER study_tasks_set_updated_at BEFORE UPDATE ON study_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_xp_set_updated_at') THEN
          CREATE TRIGGER user_xp_set_updated_at BEFORE UPDATE ON user_xp FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'subscriptions_set_updated_at') THEN
          CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'usage_limits_set_updated_at') THEN
          CREATE TRIGGER usage_limits_set_updated_at BEFORE UPDATE ON usage_limits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
      END $$;
    `,
  },
  {
    id: '0002_phase2_education_level',
    sql: `
      ALTER TABLE profiles
        ADD COLUMN IF NOT EXISTS education_level TEXT NOT NULL DEFAULT 'beginner';

      ALTER TABLE profiles
        DROP CONSTRAINT IF EXISTS profiles_education_level_check;

      ALTER TABLE profiles
        ADD CONSTRAINT profiles_education_level_check
        CHECK (education_level IN ('beginner', 'intermediate', 'advanced'));
    `,
  },
  {
    id: '0003_phase5_planner_priority',
    sql: `
      ALTER TABLE study_tasks
        ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';

      ALTER TABLE study_tasks
        DROP CONSTRAINT IF EXISTS study_tasks_priority_check;

      ALTER TABLE study_tasks
        ADD CONSTRAINT study_tasks_priority_check
        CHECK (priority IN ('low', 'medium', 'high'));
    `,
  },
  {
    id: '0004_activities',
    sql: `
      CREATE TABLE IF NOT EXISTS activities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        subtitle TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS activities_user_created_idx ON activities(user_id, created_at DESC);
    `,
  },
  {
    id: '0005_email_otp',
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;

      UPDATE users
        SET is_verified = true
        WHERE email_verified_at IS NOT NULL;

      CREATE TABLE IF NOT EXISTS email_otps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL,
        otp TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS email_otps_email_idx ON email_otps(email);
      CREATE INDEX IF NOT EXISTS email_otps_created_idx ON email_otps(created_at DESC);
    `,
  },
];

export const runMigrations = async (): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM _schema_migrations'
    );
    const appliedIds = new Set(rows.map((r) => r.id));

    for (const migration of MIGRATIONS) {
      if (!appliedIds.has(migration.id)) {
        console.log(`[Database] Applying migration: ${migration.id}...`);
        await client.query('BEGIN');
        try {
          await client.query(migration.sql);
          await client.query(
            'INSERT INTO _schema_migrations (id) VALUES ($1)',
            [migration.id]
          );
          await client.query('COMMIT');
          console.log(`[Database] Migration ${migration.id} applied successfully.`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`[Database] Migration ${migration.id} failed:`, err);
          throw err;
        }
      }
    }

    console.log('[Database] All migrations are up to date.');
  } finally {
    client.release();
  }
};

// If executed directly: tsx src/config/migrate.ts or node dist/config/migrate.js
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').match(/migrate\.(ts|js)$/);
if (isDirectRun) {
  runMigrations()
    .then(() => {
      console.log('[Database] Migration run complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Database] Migration run failed:', err);
      process.exit(1);
    });
}
