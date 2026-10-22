import Link from "next/link";
import type { LinkComponent } from "@healthcare/ui/layouts";

/** `next/link` as the design system's router-agnostic `Link`, for server components that pass it to templates and tiles. */
export const NextLink: LinkComponent = (props) => <Link {...props} />;
