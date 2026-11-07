# Runbook: running your own LiveKit server for online consultations

**When to use it.** Online consultations use LiveKit for video (`LiveKitVideoProvider`, `libs/telemedicine/src/lib/video.ts`). You can subscribe to LiveKit Cloud
or run the open-source server yourself. This runbook is for running it yourself on a virtual machine. The platform needs only three variables and does not care
which you choose: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

**Sources and what is not verified.** The steps below follow LiveKit's own self-hosting pages (the VM guide and the ports and firewall reference at
`docs.livekit.io/transport/self-hosting/`), read on 2026-11-05. LiveKit changes its tooling: read those pages again before you start. Three things its pages do
not state, and this runbook therefore does not invent: a minimum machine size, how the API key and secret are created, and how Redis is used. The steps say where
to look for each. Nothing here has been run against a real server by us; only a local LiveKit development server has been tested with the platform.

**Who does this.** A person who can manage a Linux server and DNS for the clinic's domain. If nobody can, use LiveKit Cloud instead.

## Before you start

You need:

- A virtual machine with a **public IP address** (a VPS from any provider). LiveKit tests Ubuntu and Amazon Linux. Railway is not suitable: video needs UDP ports.
- A domain you own, and the ability to add DNS records. Two names are needed: one for the server (for example `video.clinic.example.ph`) and one for TURN (for
  example `turn.clinic.example.ph`). Both point to the VM's public IP address.
- Docker on your own computer, to generate the configuration.
- The platform's API running with access to its environment variables (local `.env`, or Railway variables).

**Size the machine.** LiveKit's pages give no figure. Start with the provider's smallest plan that has a dedicated public IP, run a real two-person test (step
9), and watch CPU and network use during a call. A one-to-one doctor and patient call is a light load; many calls at once are not. Resize if the test shows
strain.

**Privacy.** The video of a consultation passes through this server. Decide with your data protection officer where the VM is hosted and who can sign in to it.
Nothing here changes what the platform records; compliance stays the organization's to validate (`docs/security/compliance-dependencies.md`).

## 1. Point the domain at the machine

1. Create two DNS records, both pointing to the VM's public IP address (record type `A` for IPv4): the primary name and the TURN name.
2. Wait until they resolve: `host video.clinic.example.ph` should show the VM's IP address. The server's certificates are issued automatically by Caddy, and that
   needs both names to resolve first.

## 2. Open the ports

Open these on the VM's firewall **and** in the provider's own firewall or security group (providers often block everything by default):

| Port          | Protocol | Why                                |
| ------------- | -------- | ---------------------------------- |
| 80            | TCP      | Certificate issuance               |
| 443           | TCP      | HTTPS, and TURN over TLS           |
| 7881          | TCP      | Video over TCP when UDP is blocked |
| 3478          | UDP      | TURN and STUN                      |
| 50000 - 60000 | UDP      | Video (WebRTC) over UDP            |

LiveKit's example commands for a firewall also open `443/udp`, which its own port list does not include; opening it does no harm. The TURN service is what lets
patients behind strict networks or on mobile data connect: do not leave it out.

## 3. Generate the configuration (on your computer)

LiveKit publishes a generator that asks for your domains and writes the configuration:

```bash
docker pull livekit/generate
docker run --rm -it -v$PWD:/output livekit/generate
```

It asks for the domain names and what to install, and creates a folder named after your domain with `caddy.yaml`, `docker-compose.yaml`, `livekit.yaml`,
`redis.conf` and either `init_script.sh` or a `cloud_init.<name>.yaml` file. Skip the optional Ingress and Egress components: online consultations do not use
them.

**Find the API key and secret.** LiveKit's VM page does not say where they come from. Open the generated `livekit.yaml` and look for the `keys:` section: each line
is a key name and its secret. Copy one pair for step 6. Treat the secret like a password: keep it out of chat, email and source control.

**Redis.** The generator also writes `redis.conf` and its compose file starts Redis next to LiveKit. LiveKit's pages do not explain Redis for a single server; leave
the generated setting as it is. It is separate from the platform's own Redis.

## 4. Put it on the machine

Use one of these, as the generator's folder offers.

- **Cloud-init** (many providers): paste the contents of `cloud_init.<name>.yaml` into the machine's **User data** field when you create it.
- **Startup script:** create the machine as usual, copy `init_script.sh` to it, sign in over SSH and run:

  ```bash
  sudo ./init_script.sh
  ```

Either way, it installs Docker, puts the configuration in `/opt/livekit` and creates a system service named `livekit-docker`.

## 5. Check that it is up

On the machine:

```bash
systemctl status livekit-docker
cd /opt/livekit
sudo docker-compose logs
```

From your computer, the primary address should answer over HTTPS with a certificate that is trusted (no browser warning):

```bash
curl -i https://video.clinic.example.ph
```

A connection error usually means DNS has not reached the machine yet, or port 80 or 443 is closed. Certificates are requested only once both names resolve.

## 6. Connect the platform

Set these on the API (local `.env`, or Railway variables) and restart it:

| Variable             | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| `LIVEKIT_URL`        | `wss://video.clinic.example.ph` (the primary name, with `wss://`) |
| `LIVEKIT_API_KEY`    | the key name from `livekit.yaml`                                  |
| `LIVEKIT_API_SECRET` | its secret                                                        |

Why `wss://`: the platform gives this address to the patient's browser or phone to connect, so it must be the public secure address. It also checks the server by
making a plain request to the same name over HTTPS. In production the API refuses to start with a `LIVEKIT_URL` that is not `wss://`, or a `LIVEKIT_API_SECRET`
shorter than 32 characters (if the generated secret is shorter, add a longer pair to `livekit.yaml`'s `keys:`).

**Let the browsers connect.** The staff app and MyHealth only connect to the addresses their script policy lists. Set `CSP_CONNECT_ORIGINS` on both the `staff` and
the `portal` service to the server's address (Terraform: `csp_connect_origins`), then restart them:

| Variable              | Value (staff and portal)        |
| --------------------- | ------------------------------- |
| `CSP_CONNECT_ORIGINS` | `wss://video.clinic.example.ph` |

Without it, the call is blocked in the browser even though step 7 below says the server is reachable (that check runs from the API, not the browser).

## 7. Confirm in the staff app

Sign in as someone who can open **Telemedicine → Settings** (`/telemedicine/settings`) and read the video notice. It should say the video server is reachable. If it
says it cannot be reached or answered with an error, the platform is reaching the name but not getting an answer: recheck steps 1, 2 and 5, and that the name in
`LIVEKIT_URL` is exactly the one with the certificate.

## 8. Plan for keeping it running

- **Updates.** Edit `/opt/livekit/docker-compose.yaml` and set the image under `livekit` to `livekit/livekit-server:v<version>` (or `:latest`, then
  `docker pull livekit/livekit-server`), and restart with `systemctl stop livekit-docker` then `systemctl start livekit-docker`. Do it outside clinic hours: a call
  in progress ends.
- **Monitoring.** Watch that the staff app's video notice stays green, and that the machine has disk and memory to spare. Add the address to whatever uptime
  monitor you use.
- **Backups.** The server keeps no patient records: the platform stores them. Keep a copy of `/opt/livekit` (without sharing the secret) so the machine can be
  rebuilt.
- **Changing the secret.** Edit the `keys:` pair in `livekit.yaml`, restart the service, then change `LIVEKIT_API_SECRET` on the API and restart it. Calls in
  progress end.

## 9. Test it with two people before patients use it

1. Book an online consultation for a test patient (MyHealth) with a test doctor (staff app); the telemedicine journey is described in `docs/domains/telemedicine.md`.
2. Join from two separate devices, one on the clinic's network and one on **mobile data**. The mobile data device is the real test of TURN.
3. Confirm both people see and hear each other, then end the call from the doctor's side.
4. Repeat from a patient's phone browser and from the MyHealth mobile app if you use it (it lives in its own project and connects to the same address).
5. If video does not start in a browser, open its developer console: a "Content Security Policy" message naming the video address means
   `CSP_CONNECT_ORIGINS` (step 6) is missing on that app.

If the person on mobile data cannot connect but the one on the clinic network can, TURN is the likely cause: check ports 443/TCP and 3478/UDP, and that the TURN name
resolves to the machine.

## If it stops working

- Staff app notice says the video server is not reachable: start with `systemctl status livekit-docker` and the logs in step 5.
- Everyone connects but there is no video: UDP ports 50000 - 60000 are closed somewhere (the machine's firewall or the provider's).
- Only some patients cannot connect: TURN (steps 1 and 2).
- Without the three variables, or while the server is down, an online consultation falls back to the callback number instead of video, so a visit can still go ahead.
