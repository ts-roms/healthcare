import { NextResponse, type NextRequest } from "next/server";
import { ACTING_COOKIE } from "@/lib/proxy-access";

/** Stops acting for someone else (their access ended while acting, or a page needs the person's own account). */
export function GET(request: NextRequest) {
  const ended = request.nextUrl.searchParams.get("ended") === "1";
  const response = NextResponse.redirect(new URL(ended ? "/people?ended=1" : "/people", request.url));
  response.cookies.delete(ACTING_COOKIE);
  return response;
}
