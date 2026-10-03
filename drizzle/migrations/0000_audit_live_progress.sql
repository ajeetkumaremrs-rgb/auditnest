ALTER TABLE public.audits ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE public.audits ADD COLUMN IF NOT EXISTS events jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.audits REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.audits;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;