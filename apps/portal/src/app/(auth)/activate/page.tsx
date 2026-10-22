import { AuthCard } from "@/app/(auth)/form-parts";
import Link from "next/link";
import { ActivateForm } from "./activate-form";

export const metadata = { title: "Set up your account" };

export default function ActivatePage() {
  return (
    <>
      <AuthCard
        title="Set up your account"
        description="Use the activation code the clinic gave you. We check it against your patient number and date of birth, so only you can open your record."
      >
        <ActivateForm />
      </AuthCard>
      <p className="text-body text-muted-foreground">
        Already set up?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
