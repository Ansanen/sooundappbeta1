# Soound — Mobile App Build Prompt (React Native / Expo)

## What is Soound?
A real-time synchronized music listening app. Users create rooms, share 6-letter codes, and listen to YouTube music together in perfect sync. Think "listening party" — one host controls playback, everyone else hears the same thing at the same time.

**Live web version:** https://soound.space  
**Backend API:** https://soound.space (Express + Socket.IO, already running)

---

## Architecture Overview

```
┌─────────────────────────┐
│   Mobile App (new)      │  ← You build this
│   React Native / Expo   │
│   iOS + Android         │
└──────────┬──────────────┘
           │ Socket.IO + REST
           ▼
┌─────────────────────────┐
│   Backend Server         │  ← Already running
│   Express + Socket.IO    │
│   https://soound.space   │
│   Port 3463              │
└──────────────────────────┘
```

The mobile app is a **client only**. The server already exists. You connect to `https://soound.space` via Socket.IO and REST APIs.

---

## API Reference

### REST Endpoints

```
GET  /api/search?q={query}&limit=10     → YouTube search results
GET  /api/live/{roomId}                  → Audio stream (MP3 binary)
GET  /api/stream/{youtubeId}             → Direct audio stream for a track
POST /api/upload                         → Upload audio file (multipart, field: "audio")
GET  /api/uploaded/{id}                  → Serve uploaded file
```

### YouTube Search Response
```json
[
  {
    "id": "dQw4w9WgXcQ",
    "youtubeId": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up",
    "artist": "Rick Astley",
    "duration": 213,
    "cover": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
  }
]
```

### Socket.IO Events

**Connection:**
```javascript
const socket = io("https://soound.space", {
  path: "/socket.io/",
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  timeout: 20000,
});
```

**Client → Server:**

| Event | Payload | Description |
|-------|---------|-------------|
| `join_room` | `{ roomId, userId, name, isPrivate?, password?, allowGuestQueue? }` | Join/create room |
| `play` | `{ position: number }` | Host: play at position |
| `pause` | `{ position: number }` | Host: pause at position |
| `seek` | `{ position: number }` | Host: seek to position |
| `change_track` | `{ track: Track }` | Host: change current track |
| `add_to_queue` | `{ track: Track }` | Add track to queue |
| `remove_from_queue` | `{ index: number }` | Remove from queue |
| `play_next` | `{}` | Host: skip to next in queue |
| `reaction` | `{ emoji: string }` | Send reaction (fire/heart/clap/music/spark) |
| `chat_message` | `{ text: string }` | Send chat message |
| `request_sync` | `{}` | Request current playback state |
| `host_time` | `{ position, duration, isPlaying, timestamp }` | Host: broadcast position (every 500ms) |
| `simple_play` | `{ position: number }` | Host: simple play command |
| `simple_pause` | `{ position: number }` | Host: simple pause command |
| `simple_seek` | `{ position: number }` | Host: simple seek command |
| `toggle_guest_queue` | `{}` | Host: toggle guest queue permission |
| `host_position` | `{ position: number }` | Host: report position |

**Server → Client:**

| Event | Payload | Description |
|-------|---------|-------------|
| `room_state` | Full room state object | Sent on join |
| `sync` | Full room state object | State update |
| `host_changed` | `{ hostSocketId }` | New host assigned |
| `user_count` | `number` | User count update |
| `queue_updated` | `{ queue: Track[] }` | Queue changed |
| `users_updated` | `{ users: RoomUser[] }` | User list changed |
| `song_requested` | `{ track, by }` | Someone requested a song |
| `room_settings` | `{ allowGuestQueue }` | Settings changed |
| `join_error` | `{ error: string }` | Join failed |
| `queue_error` | `{ message: string }` | Queue action failed |
| `chat_message` | `ChatMessage` | New chat message |
| `reaction` | `{ id, emoji, x }` | Reaction received |
| `live_status` | `{ status: 'loading'/'ready'/'error', ...}` | Track loading status |
| `live_stream_ready` | `{ trackId, duration, url, currentTime }` | Stream ready to play |
| `sync_play` | `{ scheduledTime, position }` | Scheduled play command |
| `sync_pause` | `{ position }` | Pause command |
| `host_time` | `{ position, duration, isPlaying, timestamp }` | Host position broadcast |
| `simple_play` | `{ position }` | Simple play command |
| `simple_pause` | `{ position }` | Simple pause command |
| `simple_seek` | `{ position }` | Simple seek command |
| `live_time` | `{ currentTime, duration }` | Time update |

### Room State Object
```typescript
{
  hostSocketId: string;
  userCount: number;
  users: RoomUser[];
  currentTrack: Track | null;
  isPlaying: boolean;
  queue: Track[];
  messages: ChatMessage[];
  allowGuestQueue: boolean;
  liveStreamUrl?: string;        // "/api/live/{roomId}"
  liveStreamDuration?: number;
}
```

---

## Data Types

```typescript
interface Track {
  id: string;
  title: string;
  artist: string;
  url: string;                    // "/api/stream/{youtubeId}"
  cover: string;                  // YouTube thumbnail URL
  duration?: number;              // seconds
  source?: 'youtube' | 'upload';
  youtubeId?: string;
  requestedBy?: string;
}

interface RoomUser {
  socketId: string;
  name: string;
  isHost: boolean;
  userId: string;
}

interface ChatMessage {
  id: string;
  text: string;
  userId: string;
  userName: string;
  timestamp: number;
  isSystem?: boolean;             // system messages like "X joined"
}
```

---

## Screens & UI

### 1. Landing Screen
- **Logo:** "Soound" text with wave animation
- **Pills:** "Real-time sync", "YouTube Music", "Free forever"
- **Tagline:** "Listen together. Anywhere."
- **Buttons:**
  - "Create Room" → Room creation flow
  - "Join Room" → Enter 6-char code
- **Name prompt** if no name stored (saved to AsyncStorage)
- **Theme:** Pure black (#050505), white text, glass-morphism elements

### 2. Room Creation
- Choose Public/Private (private has optional password)
- Toggle "Guests can add songs"
- Generates random 6-char uppercase room code

### 3. Room Screen (main experience)
**Layout (top to bottom):**

**Header:**
- Back button (leave room)
- Room code with crown icon if host
- Share button
- User count badge
- Chat button
- Search button
- Queue button (with count badge)

**Background:**
- MoodBackground: colored gradient orbs that change based on collective reactions
  - fire → orange, heart → pink, clap → gold, music → purple, spark → cyan
  - Scores decay ×0.85 every 10 seconds
- Album art blurred as additional background layer

**Player (center):**
- SoundWaveAvatar: generative hash-based visual per track (concentric rings, dots, lines on canvas)
  - Rotates when playing (20s full rotation)
  - Pulse animation (4s cycle)
  - Glass overlay
- Track title + artist
- Progress bar (seekable by host only, listeners see "Only host can seek" toast)
- Time display (current / total)
- Controls: Previous | Play/Pause | Next
- Volume slider (host only)
- Search button (open drawer)

**Reactions bar (above controls):**
- 5 reaction buttons with unique colors:
  - 🔥 Fire (#FF6B35)
  - ❤️ Heart (#FF2D78)  
  - ⭐ Clap (#FFD700)
  - 🎵 Music (#7B68EE)
  - ✨ Spark (#00D4FF)
- Each tap creates floating emoji animation
- Glass-morphism pill container with colored glow on hover

**Drawer Panel (bottom sheet, 4 tabs):**
- **Search:** YouTube search with recent searches, results show cover/title/artist/duration, "Play" (host) or "Add to Queue" buttons
- **Queue:** Ordered list, host can remove items, shows "requested by" name
- **Users:** List with host crown, user count
- **Chat:** Messages with colored names (hash-based), system messages styled differently, input at bottom

**Overlays:**
- **Listener loading overlay:** Shows progress dots + status (loading → connecting → tap to play)
- **Host loading overlay:** Spinner while track converts
- **Track notification:** Slides in when new track starts, fades after 3s

### 4. Share Modal
- QR code (from qrserver.com API)
- Room code in large tracking text
- Copy link button
- Native share button (if available)

### 5. Share Card
- Instagram-story-style card with gradient background
- Track info, room code, user count, mood label
- Downloadable as image

### 6. Onboarding (first time)
- 3-step tutorial explaining the app
- Skippable, "Don't show again" saved to storage

---

## Audio Sync Logic (CRITICAL)

### Host Flow:
1. Host selects track → server downloads YouTube audio → converts to MP3
2. Server emits `live_stream_ready` with URL
3. Client fetches audio from `/api/live/{roomId}`
4. Client plays using HTML5 Audio (or expo-av equivalent)
5. Host broadcasts position every 500ms via `host_time` event (includes timestamp)
6. On play/pause: emits `simple_play` / `simple_pause`

### Listener Flow:
1. Receives `live_stream_ready` → loads same audio URL
2. Receives `sync_play` (for late joiners) or `simple_play` → starts playback at position
3. Receives `host_time` every 500ms:
   - Calculate network delay: `networkDelay = (Date.now() - data.timestamp) / 1000`
   - Estimate host position: `estimatedPos = data.position + networkDelay`
   - If drift > 0.5s: seek to estimated position
   - If host is playing and listener is paused: auto-play
   - If host is paused and listener is playing: auto-pause
4. If no play command received within 2s of loading: emit `request_sync`

### Key Points:
- Audio URL format: `https://soound.space/api/live/{roomId}?t={timestamp}` (cache bust)
- Drift threshold: 0.5 seconds before correction
- Network delay compensation via timestamps
- Mobile autoplay: requires user gesture to start audio context

---

## Design System

### Colors
- Background: `#050505` (pure dark)
- Surface: `rgba(255,255,255,0.05)` 
- Border: `rgba(255,255,255,0.1)`
- Text primary: `#FFFFFF`
- Text secondary: `rgba(255,255,255,0.5)`
- Text muted: `rgba(255,255,255,0.3)`
- Accent: White buttons with black text

### Glass-morphism
```css
.glass-panel {
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
```

### Typography
- Font: System default (SF Pro on iOS, Roboto on Android)
- Headers: Bold, tracking wide
- Room code: Bold, letter-spacing 0.3em, uppercase

### Animations
- Page transitions: fade + scale with spring physics
- Reactions: float up from bottom, fade out over 2s
- Track notification: slide in from top, fade after 3s
- Mood background: slow breathing animation (8-12s cycles)
- SoundWaveAvatar: rotate 20s, pulse 4s
- Button press: scale(0.95) on press

### Reaction System
Each reaction has a unique color and glow effect:
```
fire:  #FF6B35 (orange glow)
heart: #FF2D78 (pink glow)
clap:  #FFD700 (gold glow)
music: #7B68EE (purple glow)
spark: #00D4FF (cyan glow)
```

---

## Tech Stack Recommendations (Mobile)

### Option A: React Native + Expo
- `expo-av` for audio playback
- `socket.io-client` for real-time
- `expo-blur` for glass effects
- `react-native-reanimated` for animations
- `@react-navigation/native` for navigation
- `expo-sharing` for native share
- `@react-native-async-storage/async-storage` for persistence

### Option B: Flutter
- `just_audio` for audio
- `socket_io_client` for real-time
- `dart:ui` for blur effects

### Audio Notes for Mobile:
- iOS requires audio session configuration for background playback
- Android needs foreground service for background audio
- Both platforms need user gesture before playing audio
- Use `staysActiveInBackground: true` (expo-av)
- Configure audio mode: `playsInSilentModeIOS: true`

---

## Current Known Issues to Fix in Mobile

1. **Late joiner sync:** When joining a room where music plays, there's a brief delay. Handle by:
   - Loading audio immediately on `live_stream_ready`
   - Waiting for `sync_play` or `host_time` to set position
   - Auto `request_sync` if no play command in 2s

2. **Background audio:** Web version stops when tab is backgrounded. Mobile should keep playing.

3. **Offline handling:** Show reconnecting UI when socket disconnects.

---

## File Structure Suggestion

```
src/
  screens/
    LandingScreen.tsx
    RoomScreen.tsx
    OnboardingScreen.tsx
  components/
    room/
      PlayerSection.tsx
      RoomHeader.tsx
      DrawerPanel.tsx
      SearchTab.tsx
      QueueTab.tsx
      UsersTab.tsx
      ChatTab.tsx
      MoodBackground.tsx
      SoundWaveAvatar.tsx
      ShareModal.tsx
      ReactionBar.tsx
    SooundLogo.tsx
    AnimatedWaves.tsx
  hooks/
    useRoom.ts              # Socket.IO room management
    useAudio.ts             # Audio playback + sync
  lib/
    socket.ts               # Socket.IO connection
    types.ts                # TypeScript interfaces
    storage.ts              # AsyncStorage helpers
  navigation/
    AppNavigator.tsx
```

---

## Build & Deploy

### iOS
- Requires Apple Developer account
- Build with `eas build --platform ios`
- TestFlight for testing

### Android  
- Build with `eas build --platform android`
- APK or AAB for Play Store

---

## Summary

Build a React Native (Expo) mobile app that:
1. Connects to `https://soound.space` via Socket.IO
2. Plays synchronized audio from the server's REST API
3. Replicates the UI/UX described above (dark theme, glass-morphism, reactions, chat)
4. Supports background audio playback
5. Works on both iOS and Android

The server is already complete and running. You only need to build the client.
