import type { MessageSender, MessageTopic, ThreadStatus } from "./patient-message.rules";

export interface MessageView {
  id: string;
  sender: MessageSender;
  /** The staff member's name for a clinic message; "You" is decided by the reader. */
  senderName: string | null;
  body: string;
  /** A guardian wrote this for the patient. */
  viaGuardian: boolean;
  createdAt: string;
}

/** A conversation as the patient sees it. */
export interface PortalThreadView {
  id: string;
  topic: MessageTopic;
  subject: string;
  status: ThreadStatus;
  startedBy: MessageSender;
  messageCount: number;
  lastMessageAt: string;
  lastMessageFrom: MessageSender;
  /** The clinic wrote and the patient has not read it. */
  unread: boolean;
}

export interface PortalThreadDetail extends PortalThreadView {
  messages: MessageView[];
}

/** A conversation as the clinic sees it. */
export interface StaffThreadView extends PortalThreadView {
  patientId: string;
  patientNumber: string;
  patientName: string;
  facilityId: string;
  assignedTo: { id: string; displayName: string } | null;
  /** Open, and the patient wrote last. */
  awaitingClinic: boolean;
  closedAt: string | null;
  version: number;
}

export interface StaffThreadDetail extends StaffThreadView {
  messages: MessageView[];
}
