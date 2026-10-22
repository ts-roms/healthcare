import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "@healthcare/core";
import { AccessToken } from "livekit-server-sdk";

export interface VideoParticipant {
  /** Opaque, stable identity: "patient:<id>" or "staff:<userId>". */
  identity: string;
  /** Shown to the other participant. */
  name: string;
}

export interface VideoJoin {
  /** WebSocket URL the browser connects to. */
  url: string;
  token: string;
  room: string;
  expiresInSeconds: number;
}

/**
 * The video component of an online consultation (CLAUDE.md §10): a managed
 * WebRTC provider behind a port, so it can be replaced. The platform owns the
 * clinical workflow; the provider only carries audio and video. Calls are not
 * recorded.
 */
export interface VideoProvider {
  readonly configured: boolean;
  join(room: string, participant: VideoParticipant): Promise<VideoJoin>;
  /** Whether the provider answers right now (a quick probe; never throws). */
  check(): Promise<VideoReadiness>;
}

/** Whether online consultations can use video: set up, and answering. */
export interface VideoReadiness {
  configured: boolean;
  /** Null when not configured (nothing to reach). */
  reachable: boolean | null;
  checkedAt: Date;
  /** What went wrong, in plain words (never a credential or a full address). */
  detail: string | null;
}

export const VIDEO_PROVIDER = Symbol("VIDEO_PROVIDER");
const TOKEN_TTL_SECONDS = 2 * 60 * 60;
const PROBE_TIMEOUT_MS = 3000;
/** A probe is reused for this long, so a busy staff screen does not hammer the video server. */
const PROBE_CACHE_MS = 30_000;

/** LiveKit (self-hosted or LiveKit Cloud): short-lived room tokens signed with the API secret. */
@Injectable()
export class LiveKitVideoProvider implements VideoProvider {
  readonly configured: boolean;
  private lastCheck: VideoReadiness | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.configured = Boolean(config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET);
  }

  async join(room: string, participant: VideoParticipant): Promise<VideoJoin> {
    if (!this.configured) throw new Error("Video is not configured");
    const token = new AccessToken(this.config.LIVEKIT_API_KEY, this.config.LIVEKIT_API_SECRET, {
      identity: participant.identity,
      name: participant.name,
      ttl: TOKEN_TTL_SECONDS,
    });
    // Join one room only; no recording, no room administration.
    token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false });
    return { url: this.config.LIVEKIT_URL!, token: await token.toJwt(), room, expiresInSeconds: TOKEN_TTL_SECONDS };
  }

  /**
   * LiveKit answers a plain HTTP request on the address its WebSocket listens on (wss becomes https, ws becomes http), so one
   * GET tells whether the server is up. Only reachability is tested: no room is created and no credential is sent.
   */
  async check(): Promise<VideoReadiness> {
    const now = new Date();
    if (!this.configured) return { configured: false, reachable: null, checkedAt: now, detail: "Video is not set up on this server." };
    if (this.lastCheck && now.getTime() - this.lastCheck.checkedAt.getTime() < PROBE_CACHE_MS) return this.lastCheck;
    let reachable = false;
    let detail: string | null = null;
    try {
      const url = new URL(this.config.LIVEKIT_URL!);
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      reachable = response.ok;
      if (!reachable) detail = `The video server answered with an error (${response.status}).`;
    } catch (error) {
      detail = error instanceof Error && error.name === "TimeoutError" ? "The video server did not answer in time." : "The video server could not be reached.";
    }
    this.lastCheck = { configured: true, reachable, checkedAt: now, detail };
    return this.lastCheck;
  }
}
