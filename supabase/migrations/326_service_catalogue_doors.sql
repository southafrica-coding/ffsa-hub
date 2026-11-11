-- ============================================================
-- FFSA Hub — Migration 326: Service catalogue doors
-- ============================================================
-- 319 is already applied and stays byte-identical. This file only
-- changes catalogue doors that 319 pointed at pages the viewer cannot
-- open.
--
-- brand_kit open_to_all use: deleted. The brand-kit page requires
-- brand_kit.view, which no role is granted, so that door sent every
-- signed-in person to /dashboard. Media keeps own and manage.
--
-- gear_hire open_to_all use: admin_href becomes /hire, the public
-- storefront. services.admin_href and the own/manage rows stay
-- /bookings/equipment. The viewer sends that register only to a caller
-- who passes has_equipment_access().
--
-- Natural keys only. A second paste deletes nothing extra and updates
-- a row only while its href is still the old door.
-- ============================================================

DELETE FROM public.service_owners
 WHERE service_key = 'brand_kit'
   AND capability = 'use'
   AND open_to_all
   AND any_point_leader = false
   AND staff_ministry_id IS NULL;

UPDATE public.service_owners
   SET admin_href = '/hire'
 WHERE service_key = 'gear_hire'
   AND capability = 'use'
   AND open_to_all
   AND any_point_leader = false
   AND staff_ministry_id IS NULL
   AND admin_href IS DISTINCT FROM '/hire';
