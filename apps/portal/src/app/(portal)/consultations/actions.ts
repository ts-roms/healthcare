"use server";

import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";
import type { PortalTeleconsult, VideoJoin } from "@/lib/api/types";
import { type QuestionnaireForm, questionnairePayload } from "@/lib/teleconsult";

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
