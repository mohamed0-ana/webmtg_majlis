# Majlis (مجلس) - team meeting tool

Video meetings for small teams (2 to 6 people) with:

- **Invitation links**: press Invite, share the link (copy, share sheet or email).
- **Screen share**: shared screen automatically becomes the main view for everyone.
- **Recording**: records the whole meeting (all videos, shared screen, all voices) to a .webm file saved on the recorder's computer. Everyone sees a REC badge.
- **Live transcript**: Chrome or Edge, English / Arabic / Japanese. Each person's browser transcribes their own voice.
- **Claude notes**: one button sends the transcript to Claude and returns summary, decisions, action items and open questions (Markdown, downloadable).
- No time limit. Video goes directly between browsers (WebRTC); the server only relays small setup messages.

## Deploy free on Render (about 5 minutes)

1. Put this folder in a GitHub repository.
2. On render.com: New > Blueprint (or Web Service) > pick the repo. `render.yaml` is already set up.
3. In the service's Environment tab add:
   - `ANTHROPIC_API_KEY` : your key from console.anthropic.com (needed for Claude notes)
   - `ACCESS_CODE` : optional team password, so strangers cannot use your API key
4. Open the Render URL, press "Start a new meeting", then Invite.

Free Render services sleep after about 15 minutes idle; the first visit takes about 30 seconds to wake up. Open the link a minute before the meeting.

## Run on your own PC

    npm install
    ANTHROPIC_API_KEY=sk-ant-... ACCESS_CODE=myteam node server.js

Open http://localhost:3000. To let teammates in, use a free tunnel such as `cloudflared tunnel --url http://localhost:3000`. Camera, microphone and screen share only work on https or localhost.

## Settings (environment variables)

| Variable | Purpose |
|---|---|
| ANTHROPIC_API_KEY | Enables Claude notes |
| CLAUDE_MODEL | Model used for notes (default claude-sonnet-4-5) |
| ACCESS_CODE | Optional team password for joining and for notes |
| MAX_PEERS | Max people per meeting (default 6) |
| TURN_URL, TURN_USER, TURN_PASS | Optional TURN relay (see below) |

## Good to know

- **TURN server**: most connections work with the built-in free STUN server. People behind strict corporate firewalls may fail to connect; add a TURN service (for example a free tier from Metered or Cloudflare) through the TURN_* variables.
- **Six people is the practical limit** because every browser sends video to every other browser.
- **Recording** needs the recorder's tab kept open; it records at 720p and saves when they press Stop or Leave. Ask for consent before recording.
- **Transcript quality** depends on each person's microphone and Chrome's speech recognition (it sends audio to Google). If that is a concern for your project, skip the Transcript button and paste a transcript from another source into your own notes.
- Meeting content is never stored on the server.
