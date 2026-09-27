import Link from "next/link";
import { ActivateForm } from "./activate-form";

export const metadata = { title: "Set up your account" };

export default function ActivatePage() {
  return (
    <>
      <div>
        <h1 className="text-page-lg font-semibold tracking-tight">Set up your account</h1>
        <p className="text-muted-foreground">
          Use the activation code the clinic gave you. We check it against your patient number and date of birth, so only you can open your record.
        </p>
      </div>
      <ActivateForm />
      <p className="text-body text-muted-foreground">
        Already set up?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
