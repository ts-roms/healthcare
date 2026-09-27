import { FlaskConicalIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Results" };

/** Patient-facing results: only results released for patient access will ever be listed here. */
export default function ResultsPage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-page-lg font-semibold">Your results</h1>
      <EmptyState icon={FlaskConicalIcon} title="No results to show yet">
        When the laboratory finishes a test and your doctor releases it to you, it will appear here with an explanation in plain language. Questions about a
        test you had? Contact the clinic.
      </EmptyState>
    </div>
  );
}
