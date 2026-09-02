-- White Glove TMS (Postgres). Lambda may persist JSON to S3 until RDS is enabled.
CREATE TABLE IF NOT EXISTS app_user (
  id UUID PRIMARY KEY,
  cognito_sub TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('therapist', 'admin')),
  display_name TEXT NOT NULL DEFAULT '',
  provider_id UUID,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  district TEXT NOT NULL DEFAULT '',
  signer_name TEXT NOT NULL DEFAULT '',
  signer_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES app_user (id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  discipline TEXT NOT NULL CHECK (discipline IN ('OT', 'PT', 'SLP')),
  pay_rate NUMERIC,
  hha_caregiver_code TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_note (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES provider (id),
  author_id UUID NOT NULL REFERENCES app_user (id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student (
  id UUID PRIMARY KEY,
  school_id UUID REFERENCES school (id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  dob TEXT NOT NULL DEFAULT '',
  program_id TEXT NOT NULL DEFAULT '',
  program_type TEXT NOT NULL DEFAULT '',
  hha_patient_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mandate (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES student (id),
  provider_id UUID REFERENCES provider (id),
  service_type TEXT NOT NULL,
  discipline TEXT NOT NULL DEFAULT '',
  frequency_per_week NUMERIC NOT NULL,
  ratio_group BOOLEAN NOT NULL DEFAULT FALSE,
  source_pdf_key TEXT NOT NULL DEFAULT '',
  parsed_at TIMESTAMPTZ,
  start_on DATE,
  end_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weekly_period (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES provider (id),
  week_start DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'signed', 'locked', 'reopened')),
  signer_name TEXT NOT NULL DEFAULT '',
  signer_email TEXT NOT NULL DEFAULT '',
  timesheet_key TEXT NOT NULL DEFAULT '',
  signed_key TEXT NOT NULL DEFAULT '',
  envelope_id TEXT NOT NULL DEFAULT '',
  hha_status TEXT NOT NULL DEFAULT 'none',
  UNIQUE (provider_id, week_start)
);

CREATE TABLE IF NOT EXISTS session_row (
  id UUID PRIMARY KEY,
  week_id UUID NOT NULL REFERENCES weekly_period (id),
  student_id UUID NOT NULL REFERENCES student (id),
  date_of_service TEXT NOT NULL,
  begin_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  attendance TEXT NOT NULL CHECK (attendance IN ('attended', 'missed', 'makeup')),
  cancel_reason TEXT NOT NULL DEFAULT '',
  makeup_of_session_id UUID REFERENCES session_row (id),
  service_type TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  ai_flags JSONB,
  UNIQUE (makeup_of_session_id)
);

CREATE TABLE IF NOT EXISTS stored_file (
  id UUID PRIMARY KEY,
  student_id UUID REFERENCES student (id),
  provider_id UUID REFERENCES provider (id),
  week_id UUID REFERENCES weekly_period (id),
  kind TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS due_date (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES student (id),
  kind TEXT NOT NULL CHECK (kind IN ('progress', 'annual', 'reeval')),
  due_on DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  last_nag_on DATE
);

CREATE TABLE IF NOT EXISTS alert_row (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES app_user (id),
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  body TEXT NOT NULL,
  entity_ref TEXT NOT NULL DEFAULT '',
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hha_transfer (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES session_row (id),
  week_id UUID NOT NULL REFERENCES weekly_period (id),
  status TEXT NOT NULL,
  hha_visit_id TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  payload_hash TEXT NOT NULL DEFAULT '',
  UNIQUE (session_id)
);

CREATE TABLE IF NOT EXISTS audit_event (
  id UUID PRIMARY KEY,
  actor_id UUID,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
