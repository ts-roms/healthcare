import Link from "next/link";
import { BrandMark, PlatformHighlightsPanel } from "@/components/platform-highlights";

/**
 * Signed-out pages: a split page with the platform details on the left and the form on
 * the right. Below `lg` the details panel is hidden and the form stands alone under the brand.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <PlatformHighlightsPanel className="hidden lg:flex" />
      <main className="flex flex-col px-4 py-8 sm:px-8">
        <BrandMark className="lg:hidden" />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="text-center text-meta text-muted-foreground">
          For authorized clinic, laboratory and billing staff only.{" "}
          <Link href="/welcome" className="font-medium text-primary underline-offset-4 hover:underline">
            About the platform
          </Link>
        </p>
      </main>
    </div>
  );
}
