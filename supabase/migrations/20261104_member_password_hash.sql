-- Per-member login passwords (Admin/HR set; employee can change later)
alter table company_members add column if not exists password_hash text;
