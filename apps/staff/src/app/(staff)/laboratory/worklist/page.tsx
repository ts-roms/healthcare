import { getLabWorklist } from "@/lib/demo-data";
import { LabWorkbench } from "./workbench";

export const metadata = { title: "Lab worklist" };

export default async function WorklistPage() {
  return <LabWorkbench orders={await getLabWorklist()} />;
}
