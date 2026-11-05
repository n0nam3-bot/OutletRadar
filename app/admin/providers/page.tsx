import type { Metadata } from "next";
import ProviderDashboard from "./ProviderDashboard";

export const metadata: Metadata = {
  title: "Provider health | Outlet Radar",
  description: "Private Outlet Radar provider diagnostics.",
  robots: { index: false, follow: false },
};

export default function ProviderAdminPage() {
  return <ProviderDashboard />;
}
