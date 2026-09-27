import "server-only";
import { cache } from "react";
import { portalApi } from "./client";
import type { PortalMe } from "./types";

/** The signed-in patient (one API call per request). */
export const getMe = cache(() => portalApi<PortalMe>("/portal/me"));
