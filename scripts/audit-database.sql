-- Comprehensive Database Schema Audit
-- Run this in Railway PostgreSQL to get exact schema state

-- 1. List all tables
SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;

-- 2. Users table schema
\d users

-- 3. Subscriptions table schema
\d subscriptions

-- 4. Payment attempts table schema
\d payment_attempts

-- 5. Events table schema
\d events

-- 6. Admin actions table schema
\d admin_actions

-- 7. All constraints
SELECT 
  constraint_name, 
  table_name, 
  constraint_type 
FROM information_schema.table_constraints 
WHERE table_schema='public'
ORDER BY table_name, constraint_name;

-- 8. All check constraints
SELECT 
  constraint_name, 
  table_name, 
  check_clause 
FROM information_schema.check_constraints 
WHERE constraint_schema='public'
ORDER BY table_name;

-- 9. Users table columns detail
SELECT 
  column_name, 
  data_type, 
  is_nullable 
FROM information_schema.columns 
WHERE table_name='users'
ORDER BY ordinal_position;

-- 10. Subscriptions table columns detail
SELECT 
  column_name, 
  data_type, 
  is_nullable 
FROM information_schema.columns 
WHERE table_name='subscriptions'
ORDER BY ordinal_position;

-- 11. Payment attempts columns detail
SELECT 
  column_name, 
  data_type, 
  is_nullable 
FROM information_schema.columns 
WHERE table_name='payment_attempts'
ORDER BY ordinal_position;
