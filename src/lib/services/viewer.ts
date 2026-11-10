import "server-only";

// Service catalogue for a signed-in viewer. Re-exported from the department
// viewer so server components import one services module. The function
// takes the user-session client only.

export { loadServicesForViewer } from "@/lib/departments/viewer";
