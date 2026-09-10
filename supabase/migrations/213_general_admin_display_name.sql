-- ============================================================
-- FFSA Hub — Migration 213: name the `admin` role "General Admin"
-- ============================================================
-- Migration 212 carved the Records Library out of the `admin` role,
-- making it a genuine second tier: everything super_admin can reach,
-- except the Records Library. Give it a name that says so, since it
-- is now offered in the Job titles picker on a user's Access tab.
--
-- Role NAME (`admin`) is unchanged — it is hardcoded in is_admin()
-- and in dozens of policies and routes. Only the label moves.
-- ============================================================

UPDATE public.roles
SET display_name = 'General Admin',
    description  = 'Same access as a Super Admin, except the Records Library. '
                   'Can manage people, events, finance, users and roles. '
                   'Grant records_library.manage separately if they need the Records Library.'
WHERE name = 'admin';
