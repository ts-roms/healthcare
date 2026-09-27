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
}

export const VIDEO_PROVIDER = Symbol("VIDEO_PROVIDER");
const TOKEN_TTL_SECONDS = 2 * 60 * 60;

/** LiveKit (self-hosted or LiveKit Cloud): short-lived room tokens signed with the API secret. */
@Injectable()
export class LiveKitVideoProvider implements VideoProvider {
  readonly configured: boolean;

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
}
