-- public.csv_records table
CREATE TABLE IF NOT EXISTS public.csv_records (
    id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name TEXT NOT NULL,
    uuid TEXT NOT NULL,
    data JSONB NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT csv_records_uuid_unique UNIQUE (uuid)
);
