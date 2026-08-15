import Dashboard from "./dashboard";
import { loadServerComparison } from "./data/server-comparison";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <Dashboard data={await loadServerComparison()} />;
}
