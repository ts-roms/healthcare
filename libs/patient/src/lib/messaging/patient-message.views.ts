import type { MessageSender, MessageTopic, ThreadStatus } from "./patient-message.rules";

/** A document carried by a message (opened through a short-lived audited link). */
export interface AttachmentView {
  documentId: string;
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface MessageView {
  id: string;
  sender: MessageSender;
  /** The staff member's name for a clinic message; "You" is decided by the reader. */
  senderName: string | null;
  body: string;
  /** A guardian wrote this for the patient. */
  viaGuardian: boolean;
  createdAt: string;
  attachments: AttachmentView[];
}

/** A staff-only note on a conversation (never in a portal view). */
export interface NoteView {
  id: string;
  authorName: string | null;
  body: string;
  createdAt: string;
}

/** Routing and response target for one topic at a facility (migration 0097). */
export interface MessageSettingView {
  id: string;
  facilityId: string;
  topic: MessageTopic;
  routeRoleKey: string | null;
  routeUserId: string | null;
  routeUserName: string | null;
  autoAssign: boolean;
  responseTargetHours: number | null;
  version: number;
  updatedAt: string;
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
  /** When the clinic means to have answered (null without a target or once answered), and whether that has passed. */
  responseDueAt: string | null;
  overdue: boolean;
  noteCount: number;
  closedAt: string | null;
  version: number;
}

export interface StaffThreadDetail extends StaffThreadView {
  messages: MessageView[];
  notes: NoteView[];
}
