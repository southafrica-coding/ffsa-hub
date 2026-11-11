-- Undo migration 326. Restores the 319 catalogue doors.
-- brand_kit open_to_all use comes back with the service's admin_href.
-- gear_hire open_to_all use returns to that same staff href.
-- Run on prod only with an explicit OK. Natural keys only.

INSERT INTO public.service_owners (
  service_key, staff_ministry_id, capability, member_role, any_point_leader, open_to_all, admin_href
)
SELECT 'brand_kit', NULL, 'use', NULL, false, true, s.admin_href
  FROM public.services s
 WHERE s.service_key = 'brand_kit'
   AND NOT EXISTS (
     SELECT 1
       FROM public.service_owners so
      WHERE so.service_key = 'brand_kit'
        AND so.capability = 'use'
        AND so.open_to_all
        AND so.any_point_leader = false
        AND so.staff_ministry_id IS NULL
   );

UPDATE public.service_owners so
   SET admin_href = s.admin_href
  FROM public.services s
 WHERE s.service_key = 'gear_hire'
   AND so.service_key = 'gear_hire'
   AND so.capability = 'use'
   AND so.open_to_all
   AND so.any_point_leader = false
   AND so.staff_ministry_id IS NULL
   AND so.admin_href IS DISTINCT FROM s.admin_href;
