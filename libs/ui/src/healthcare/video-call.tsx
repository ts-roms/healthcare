"use client";

import * as React from "react";
import { LoaderIcon, MicIcon, MicOffIcon, PhoneOffIcon, UserRoundIcon, VideoIcon, VideoOffIcon, WifiOffIcon } from "lucide-react";
import { ConnectionState, type RemoteTrack, Room, RoomEvent, Track } from "livekit-client";
import { Button } from "../primitives/button";
import { cn } from "../lib/utils";

export interface VideoCallProps {
  /** WebSocket URL and short-lived room token from the platform's API (never created in the browser). */
  url: string;
  token: string;
  /** Who the user is waiting for, e.g. "your doctor" or the patient's name. */
  remoteLabel: string;
  /** Called when the user leaves or the call drops for good. */
  onLeave?: () => void;
  className?: string;
}

type Status = "connecting" | "connected" | "reconnecting" | "disconnected" | "blocked";

const STATUS_TEXT: Record<Status, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Connection unstable — reconnecting…",
  disconnected: "Call ended",
  blocked: "Camera or microphone blocked — allow them in your browser settings",
};

/**
 * One-to-one video for online consultations (the browser side of the LiveKit
 * adapter). Media flows between the participants through the provider; the
 * platform only issues room tokens. Nothing is recorded. Status is shown as
 * words and icons, not colour alone.
 */
export function VideoCall({ url, token, remoteLabel, onLeave, className }: VideoCallProps) {
  const remoteVideo = React.useRef<HTMLVideoElement>(null);
  const localVideo = React.useRef<HTMLVideoElement>(null);
  const audioHost = React.useRef<HTMLDivElement>(null);
  const roomRef = React.useRef<Room | null>(null);
  const [status, setStatus] = React.useState<Status>("connecting");
  const [remoteName, setRemoteName] = React.useState<string | null>(null);
  const [remoteVideoOn, setRemoteVideoOn] = React.useState(false);
  const [micOn, setMicOn] = React.useState(true);
  const [cameraOn, setCameraOn] = React.useState(true);

  React.useEffect(() => {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    let active = true;

    const attach = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video && remoteVideo.current) {
        track.attach(remoteVideo.current);
        setRemoteVideoOn(true);
      } else if (track.kind === Track.Kind.Audio && audioHost.current) {
        audioHost.current.appendChild(track.attach());
      }
    };
    room
      .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        setRemoteName(participant.name || participant.identity);
        attach(track);
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
        if (track.kind === Track.Kind.Video) setRemoteVideoOn(false);
      })
      .on(RoomEvent.ParticipantConnected, (participant) => setRemoteName(participant.name || participant.identity))
      .on(RoomEvent.ParticipantDisconnected, () => {
        setRemoteName(null);
        setRemoteVideoOn(false);
      })
      .on(RoomEvent.LocalTrackPublished, (publication) => {
        if (publication.track?.kind === Track.Kind.Video && localVideo.current) publication.track.attach(localVideo.current);
      })
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        if (!active) return;
        if (state === ConnectionState.Connected) setStatus("connected");
        else if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) setStatus("reconnecting");
        else if (state === ConnectionState.Disconnected) setStatus((s) => (s === "blocked" ? s : "disconnected"));
      });

    (async () => {
      try {
        await room.connect(url, token);
        const existing = [...room.remoteParticipants.values()][0];
        if (existing) setRemoteName(existing.name || existing.identity);
        await room.localParticipant.enableCameraAndMicrophone();
        // The camera track may have been published before the preview element was ready.
        const camera = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
        if (camera && localVideo.current) camera.attach(localVideo.current);
      } catch (error) {
        if (!active) return;
        setStatus(error instanceof Error && /permission|notallowed/i.test(`${error.name} ${error.message}`) ? "blocked" : "disconnected");
      }
    })();

    return () => {
      active = false;
      void room.disconnect();
      roomRef.current = null;
    };
  }, [url, token]);

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(!micOn);
    setMicOn(!micOn);
  };
  const toggleCamera = async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setCameraEnabled(!cameraOn);
    setCameraOn(!cameraOn);
  };
  const leave = async () => {
    await roomRef.current?.disconnect();
    setStatus("disconnected");
    onLeave?.();
  };

  const StatusIcon = status === "connected" ? VideoIcon : status === "connecting" || status === "reconnecting" ? LoaderIcon : WifiOffIcon;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-neutral-900 text-white">
        <video
          ref={remoteVideo}
          autoPlay
          playsInline
          className={cn("size-full object-cover", !remoteVideoOn && "hidden")}
          aria-label={`Video of ${remoteName ?? remoteLabel}`}
        />
        {!remoteVideoOn ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <UserRoundIcon className="size-10 opacity-60" aria-hidden />
            <p className="text-body">{remoteName ? `${remoteName} (camera off)` : `Waiting for ${remoteLabel} to join…`}</p>
          </div>
        ) : null}
        <video
          ref={localVideo}
          autoPlay
          playsInline
          muted
          className={cn("absolute right-2 bottom-2 w-1/4 min-w-24 -scale-x-100 rounded-lg border border-white/40 object-cover", !cameraOn && "hidden")}
          aria-label="Your camera"
        />
        <p role="status" className="absolute top-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-meta">
          <StatusIcon className={cn("size-3.5", status !== "connected" && status !== "blocked" && status !== "disconnected" && "animate-spin")} aria-hidden />
          {STATUS_TEXT[status]}
        </p>
        <div ref={audioHost} hidden />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant={micOn ? "outline" : "secondary"} size="sm" onClick={toggleMic} disabled={status !== "connected"} aria-pressed={!micOn}>
          {micOn ? <MicIcon /> : <MicOffIcon />} {micOn ? "Mute" : "Unmute"}
        </Button>
        <Button
          type="button"
          variant={cameraOn ? "outline" : "secondary"}
          size="sm"
          onClick={toggleCamera}
          disabled={status !== "connected"}
          aria-pressed={!cameraOn}
        >
          {cameraOn ? <VideoIcon /> : <VideoOffIcon />} {cameraOn ? "Stop camera" : "Start camera"}
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={leave} disabled={status === "disconnected"}>
          <PhoneOffIcon /> Leave call
        </Button>
      </div>
    </div>
  );
}
