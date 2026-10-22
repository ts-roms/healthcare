import { Skeleton, SkeletonCard, SkeletonGroup } from "@healthcare/ui/primitives";

/** Shown inside MyHealth while a page loads: a title and a few cards, sized for a phone. */
export default function PortalLoading() {
  return (
    <SkeletonGroup className="flex animate-in flex-col gap-4 duration-300 fade-in">
      <Skeleton className="h-7 w-44" />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={3} />
      <SkeletonCard lines={2} />
    </SkeletonGroup>
  );
}
