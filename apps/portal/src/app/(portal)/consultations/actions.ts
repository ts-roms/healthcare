"use server";

import { unstable_rethrow } from "next/navigation";
import { ApiError, userMessage } from "@healthcare/web-session";
import { portalApi } from "@/lib/api/client";
import type { PortalTeleconsult, VideoJoin } from "@/lib/api/types";
import { type QuestionnaireForm, questionnairePayload } from "@/lib/teleconsult";

type Result<T> = { ok: true; data: T } | { ok: false; message: string; code?: string; fields?: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function run<T>(call: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await call() };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ApiError) {
      const fields = Array.isArray(error.details)
        ? Object.fromEntries((error.details as Array<{ path?: string; message?: string }>).filter((d) => d.path).map((d) => [d.path!, d.message ?? ""]))
        : undefined;
      return { ok: false, message: error.message, code: error.code, fields };
    }
    return { ok: false, message: userMessage(error) };
  }
}

export async function submitQuestionnaire(appointmentId: string, form: QuestionnaireForm): Promise<Result<PortalTeleconsult>> {
  if (!UUID.test(appointmentId)) return { ok: false, message: "Invalid request." };
  return run(() => portalApi<PortalTeleconsult>(`/portal/teleconsults/${appointmentId}/questionnaire`, { method: "PUT", body: questionnairePayload(form) }));
}

export async function enterWaitingRoom(appointmentId: string): Promise<Result<PortalTeleconsult>> {
  if (!UUID.test(appointmentId)) return { ok: false, message: "Invalid request." };
  return run(() => portalApi<PortalTeleconsult>(`/portal/teleconsults/${appointmentId}/waiting-room`, { method: "POST" }));
}

/** A short-lived video token for this consultation (only once the doctor has started). */
export async function joinVideo(appointmentId: string): Promise<Result<VideoJoin>> {
  if (!UUID.test(appointmentId)) return { ok: false, message: "Invalid request." };
  return run(() => portalApi<VideoJoin>(`/portal/teleconsults/${appointmentId}/video`, { method: "POST" }));
}
