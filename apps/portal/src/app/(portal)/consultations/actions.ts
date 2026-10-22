"use server";

import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";
import type { PortalTeleconsult, TeleconsultChat, TeleconsultPayment, VideoJoin } from "@/lib/api/types";
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

/** The patient asks to pay for the visit: it is invoiced (once) and the bill is then paid in MyHealth or at the clinic. */
export async function requestPayment(appointmentId: string): Promise<Result<TeleconsultPayment>> {
  if (!UUID.test(appointmentId)) return { ok: false, message: "Invalid request." };
  return run(() => portalApi<TeleconsultPayment>(`/portal/teleconsults/${appointmentId}/payment`, { method: "POST" }));
}

/** The consultation's chat; `after` is the id of the last message already shown. */
export async function listChat(appointmentId: string, after?: string): Promise<Result<TeleconsultChat>> {
  if (!UUID.test(appointmentId) || (after !== undefined && !UUID.test(after))) return { ok: false, message: "Invalid request." };
  return run(() => portalApi<TeleconsultChat>(`/portal/teleconsults/${appointmentId}/messages${after ? `?after=${after}` : ""}`));
}

export async function sendChat(appointmentId: string, body: string): Promise<Result<TeleconsultChat["messages"][number]>> {
  const text = body.trim();
  if (!UUID.test(appointmentId) || !text || text.length > 1000) return { ok: false, message: "Write a message of up to 1,000 characters." };
  return run(() => portalApi<TeleconsultChat["messages"][number]>(`/portal/teleconsults/${appointmentId}/messages`, { method: "POST", body: { body: text } }));
}
