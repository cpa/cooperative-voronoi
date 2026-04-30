from __future__ import annotations

import asyncio
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .store import GameError, GameStore, is_valid_private_room_id

store = GameStore()
store.initialize()

app = FastAPI(title="Multiplayer Voronoi")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VIEW_TRANSFORMS = ("identity", "flipX", "flipY", "flipXY")
SIMILAR_ASPECT_RATIO_DELTA = 0.08
MATCHMAKING_TICKET_TTL_SECONDS = 90.0
MATCHMAKING_POLL_SECONDS = 20.0


@dataclass
class Viewport:
    width: int
    height: int


@dataclass
class CursorPresence:
    x: float
    y: float
    pointer_type: str
    updated_at: int


@dataclass
class PlayerPresence:
    viewport: Viewport | None = None
    view_transform: str = "identity"
    cursor: CursorPresence | None = None


@dataclass
class MatchTicket:
    id: str
    client_id: str
    created_at: float
    updated_at: float
    status: str = "waiting"
    room_id: str | None = None
    event: asyncio.Event = field(default_factory=asyncio.Event)


def viewports_are_similar(first: Viewport, second: Viewport) -> bool:
    if first.width <= 0 or first.height <= 0 or second.width <= 0 or second.height <= 0:
        return False
    first_orientation = "landscape" if first.width >= first.height else "portrait"
    second_orientation = "landscape" if second.width >= second.height else "portrait"
    if first_orientation != second_orientation:
        return False
    first_ratio = first.width / first.height
    second_ratio = second.width / second.height
    return abs(first_ratio - second_ratio) / max(first_ratio, second_ratio) <= SIMILAR_ASPECT_RATIO_DELTA


def choose_view_transform(player_id: str, presences: dict[str, PlayerPresence]) -> str:
    presence = presences.get(player_id)
    if presence is None or presence.viewport is None:
        return "identity"

    similar_player_ids = [
        current_id
        for current_id, current_presence in presences.items()
        if current_presence.viewport is not None
        and viewports_are_similar(presence.viewport, current_presence.viewport)
    ]
    if not similar_player_ids or similar_player_ids[0] == player_id:
        return "identity"

    other_transforms = [
        presences[current_id].view_transform for current_id in similar_player_ids if current_id != player_id
    ]
    if presence.view_transform in VIEW_TRANSFORMS and presence.view_transform not in other_transforms:
        return presence.view_transform

    for transform in VIEW_TRANSFORMS:
        if transform not in other_transforms:
            return transform

    counts = {transform: other_transforms.count(transform) for transform in VIEW_TRANSFORMS}
    return min(VIEW_TRANSFORMS, key=lambda transform: counts[transform])


def sanitize_viewport(width: Any, height: Any) -> Viewport:
    safe_width = int(float(width))
    safe_height = int(float(height))
    if safe_width <= 0 or safe_height <= 0:
        raise GameError("Viewport dimensions must be positive.", "invalid_viewport")
    return Viewport(width=min(safe_width, 10000), height=min(safe_height, 10000))


def sanitize_cursor(x: Any, y: Any, pointer_type: Any) -> CursorPresence:
    safe_x = float(x)
    safe_y = float(y)
    if not (0 <= safe_x <= 1 and 0 <= safe_y <= 1):
        raise GameError("Cursor coordinates must be between 0 and 1.", "invalid_cursor")
    safe_pointer_type = str(pointer_type)
    if safe_pointer_type not in {"mouse", "touch", "pen"}:
        safe_pointer_type = "mouse"
    return CursorPresence(
        x=safe_x,
        y=safe_y,
        pointer_type=safe_pointer_type,
        updated_at=int(time.time() * 1000),
    )


class ConnectionManager:
    def __init__(self, game_store: GameStore) -> None:
        self.store = game_store
        self._rooms: dict[str, dict[WebSocket, str]] = {}
        self._presence: dict[str, dict[str, PlayerPresence]] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self,
        room_id: str,
        websocket: WebSocket,
        client_id: str,
        name: str,
        color: str,
    ) -> None:
        await websocket.accept()
        self.store.upsert_player(room_id, client_id, name, color)
        async with self._lock:
            self._rooms.setdefault(room_id, {})[websocket] = client_id
            self._presence.setdefault(room_id, {}).setdefault(client_id, PlayerPresence())
        await self.broadcast_state(room_id)

    async def disconnect(self, room_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            client_id = self._rooms.get(room_id, {}).get(websocket)
            room = self._rooms.get(room_id)
            if room is not None:
                room.pop(websocket, None)
                if not room:
                    self._rooms.pop(room_id, None)
            connected = self._connected_ids_unlocked(room_id)
            if client_id and client_id not in connected:
                presence_room = self._presence.get(room_id)
                if presence_room is not None:
                    presence_room.pop(client_id, None)
                    if not presence_room:
                        self._presence.pop(room_id, None)
        self.store.maybe_lock(room_id, connected)
        await self.broadcast_state(room_id)

    async def handle_action(self, room_id: str, websocket: WebSocket, payload: dict[str, Any]) -> None:
        player_id = await self._player_for_socket(room_id, websocket)
        if player_id is None:
            await self._send_error(websocket, "Connection is no longer registered.", "not_connected")
            return
        action_type = payload.get("type")
        try:
            if action_type == "add_point":
                point = payload.get("point") or {}
                self.store.add_point(
                    room_id,
                    player_id,
                    float(point.get("x")),
                    float(point.get("y")),
                    str(point.get("color", "")),
                )
            elif action_type == "move_point":
                self.store.move_point(
                    room_id,
                    player_id,
                    str(payload.get("pointId")),
                    float(payload.get("x")),
                    float(payload.get("y")),
                )
            elif action_type == "delete_point":
                self.store.delete_point(room_id, player_id, str(payload.get("pointId")))
            elif action_type == "vote_end":
                self.store.vote_end(room_id, player_id)
                self.store.maybe_lock(room_id, await self.connected_ids(room_id))
            elif action_type == "unvote_end":
                self.store.unvote_end(room_id, player_id)
            elif action_type == "set_name":
                self.store.set_name(room_id, player_id, str(payload.get("name", "")))
            elif action_type == "set_viewport":
                viewport = payload.get("viewport") or {}
                await self.set_viewport(
                    room_id,
                    player_id,
                    sanitize_viewport(viewport.get("width"), viewport.get("height")),
                )
            elif action_type == "cursor_move":
                cursor = payload.get("cursor") or {}
                await self.set_cursor(
                    room_id,
                    player_id,
                    sanitize_cursor(cursor.get("x"), cursor.get("y"), cursor.get("pointerType", "mouse")),
                )
            elif action_type == "cursor_clear":
                await self.clear_cursor(room_id, player_id)
            else:
                raise GameError("Unknown action.", "unknown_action")
        except (TypeError, ValueError):
            await self._send_error(websocket, "Invalid message payload.", "invalid_payload")
            return
        except GameError as exc:
            await self._send_error(websocket, exc.message, exc.code)
            return
        await self.broadcast_state(room_id)

    async def set_viewport(self, room_id: str, player_id: str, viewport: Viewport) -> None:
        async with self._lock:
            presence = self._presence.setdefault(room_id, {}).setdefault(player_id, PlayerPresence())
            presence.viewport = viewport
            presence.view_transform = choose_view_transform(player_id, self._presence[room_id])

    async def set_cursor(self, room_id: str, player_id: str, cursor: CursorPresence) -> None:
        async with self._lock:
            presence = self._presence.setdefault(room_id, {}).setdefault(player_id, PlayerPresence())
            presence.cursor = cursor

    async def clear_cursor(self, room_id: str, player_id: str) -> None:
        async with self._lock:
            presence = self._presence.setdefault(room_id, {}).setdefault(player_id, PlayerPresence())
            presence.cursor = None

    async def broadcast_state(self, room_id: str) -> None:
        async with self._lock:
            sockets = list(self._rooms.get(room_id, {}).keys())
            connected = self._connected_ids_unlocked(room_id)
            presence = {
                player_id: PlayerPresence(
                    viewport=current.viewport,
                    view_transform=current.view_transform,
                    cursor=current.cursor,
                )
                for player_id, current in self._presence.get(room_id, {}).items()
            }
        state = self.store.get_state(room_id, connected)
        enrich_state_with_presence(state, presence)
        message = {"type": "state", "state": state}
        stale: list[WebSocket] = []
        for websocket in sockets:
            try:
                await websocket.send_json(message)
            except (RuntimeError, WebSocketDisconnect):
                stale.append(websocket)
        if stale:
            async with self._lock:
                room = self._rooms.get(room_id)
                if room is not None:
                    for websocket in stale:
                        room.pop(websocket, None)

    async def connected_ids(self, room_id: str) -> set[str]:
        async with self._lock:
            return self._connected_ids_unlocked(room_id)

    async def _player_for_socket(self, room_id: str, websocket: WebSocket) -> str | None:
        async with self._lock:
            return self._rooms.get(room_id, {}).get(websocket)

    def _connected_ids_unlocked(self, room_id: str) -> set[str]:
        return set(self._rooms.get(room_id, {}).values())

    async def _send_error(self, websocket: WebSocket, message: str, code: str) -> None:
        await websocket.send_json({"type": "error", "error": {"message": message, "code": code}})


manager = ConnectionManager(store)


class StrangerMatchmaker:
    def __init__(
        self,
        game_store: GameStore,
        stale_seconds: float = MATCHMAKING_TICKET_TTL_SECONDS,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self.store = game_store
        self.stale_seconds = stale_seconds
        self._now = now
        self._tickets: dict[str, MatchTicket] = {}
        self._waiting_ticket_ids: list[str] = []
        self._lock = asyncio.Lock()

    async def request_match(self, client_id: str) -> dict[str, str]:
        async with self._lock:
            now = self._now()
            self._expire_stale_unlocked(now)

            existing = self._active_ticket_for_client_unlocked(client_id)
            if existing is not None:
                return self._response(existing)

            for ticket_id in list(self._waiting_ticket_ids):
                ticket = self._tickets.get(ticket_id)
                if ticket is None or ticket.status != "waiting":
                    self._remove_waiting_unlocked(ticket_id)
                    continue
                if ticket.client_id == client_id:
                    return self._response(ticket)

                room_id = self.store.create_private_room()
                ticket.status = "matched"
                ticket.room_id = room_id
                ticket.updated_at = now
                ticket.event.set()
                self._remove_waiting_unlocked(ticket.id)
                return {"status": "matched", "roomId": room_id, "url": f"/g/{room_id}"}

            ticket = MatchTicket(id=self._create_ticket_id(), client_id=client_id, created_at=now, updated_at=now)
            self._tickets[ticket.id] = ticket
            self._waiting_ticket_ids.append(ticket.id)
            return self._response(ticket)

    async def poll_match(
        self,
        ticket_id: str,
        client_id: str,
        timeout_seconds: float = MATCHMAKING_POLL_SECONDS,
    ) -> dict[str, str]:
        ticket = await self._ticket_for_client(ticket_id, client_id)
        if ticket is None:
            return {"status": "expired"}

        if ticket.status == "waiting":
            try:
                await asyncio.wait_for(ticket.event.wait(), timeout=timeout_seconds)
            except asyncio.TimeoutError:
                pass

        ticket = await self._ticket_for_client(ticket_id, client_id)
        if ticket is None:
            return {"status": "expired"}
        return self._response(ticket)

    async def cancel_match(self, ticket_id: str, client_id: str) -> dict[str, str]:
        async with self._lock:
            self._expire_stale_unlocked(self._now())
            ticket = self._tickets.get(ticket_id)
            if ticket is None or ticket.client_id != client_id:
                return {"status": "expired"}
            if ticket.status == "waiting":
                ticket.status = "canceled"
                ticket.updated_at = self._now()
                self._remove_waiting_unlocked(ticket.id)
                ticket.event.set()
            return self._response(ticket)

    async def _ticket_for_client(self, ticket_id: str, client_id: str) -> MatchTicket | None:
        async with self._lock:
            self._expire_stale_unlocked(self._now())
            ticket = self._tickets.get(ticket_id)
            if ticket is None or ticket.client_id != client_id:
                return None
            return ticket

    def _active_ticket_for_client_unlocked(self, client_id: str) -> MatchTicket | None:
        for ticket in self._tickets.values():
            if ticket.client_id == client_id and ticket.status == "waiting":
                return ticket
        return None

    def _expire_stale_unlocked(self, now: float) -> None:
        for ticket in list(self._tickets.values()):
            if ticket.status == "waiting" and now - ticket.created_at >= self.stale_seconds:
                ticket.status = "expired"
                ticket.updated_at = now
                self._remove_waiting_unlocked(ticket.id)
                ticket.event.set()
            elif ticket.status != "waiting" and now - ticket.updated_at >= self.stale_seconds:
                self._tickets.pop(ticket.id, None)

    def _remove_waiting_unlocked(self, ticket_id: str) -> None:
        self._waiting_ticket_ids = [current_id for current_id in self._waiting_ticket_ids if current_id != ticket_id]

    def _create_ticket_id(self) -> str:
        for _ in range(10):
            ticket_id = secrets.token_urlsafe(16)
            if ticket_id not in self._tickets:
                return ticket_id
        raise GameError("Could not create a matchmaking ticket.", "ticket_creation_failed")

    def _response(self, ticket: MatchTicket) -> dict[str, str]:
        if ticket.status == "waiting":
            return {"status": "waiting", "ticketId": ticket.id}
        if ticket.status == "matched" and ticket.room_id:
            return {"status": "matched", "roomId": ticket.room_id, "url": f"/g/{ticket.room_id}"}
        if ticket.status == "canceled":
            return {"status": "canceled"}
        return {"status": "expired"}


matchmaker = StrangerMatchmaker(store)


def enrich_state_with_presence(state: dict, presence: dict[str, PlayerPresence]) -> None:
    player_by_id = {player["id"]: player for player in state["players"]}
    for player in state["players"]:
        player["viewTransform"] = presence.get(player["id"], PlayerPresence()).view_transform

    cursors = []
    for player_id, current in presence.items():
        if current.cursor is None or player_id not in state["connectedPlayerIds"]:
            continue
        player = player_by_id.get(player_id)
        cursors.append(
            {
                "playerId": player_id,
                "color": player["color"] if player else "#11181c",
                "x": current.cursor.x,
                "y": current.cursor.y,
                "pointerType": current.cursor.pointer_type,
                "updatedAt": current.cursor.updated_at,
            }
        )
    state["cursors"] = cursors


def ensure_url_room(room_id: str) -> bool:
    if not is_valid_private_room_id(room_id):
        return False
    store.ensure_room(room_id, "private")
    return True


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/games")
def create_game(_: Request) -> dict[str, str]:
    room_id = store.create_private_room()
    return {"roomId": room_id, "url": f"/g/{room_id}"}


def sanitize_matchmaking_client_id(value: Any) -> str:
    safe_client_id = str(value or "").strip()[:160]
    if not safe_client_id:
        raise HTTPException(status_code=400, detail="clientId is required")
    return safe_client_id


@app.post("/api/matchmaking/stranger")
async def create_stranger_match(request: Request) -> dict[str, str]:
    try:
        payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Expected JSON body") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Expected JSON object")
    client_id = sanitize_matchmaking_client_id(payload.get("clientId"))
    return await matchmaker.request_match(client_id)


@app.get("/api/matchmaking/stranger/{ticket_id}")
async def get_stranger_match(ticket_id: str, clientId: str = Query(...)) -> dict[str, str]:
    return await matchmaker.poll_match(ticket_id, sanitize_matchmaking_client_id(clientId))


@app.delete("/api/matchmaking/stranger/{ticket_id}")
async def delete_stranger_match(ticket_id: str, clientId: str = Query(...)) -> dict[str, str]:
    return await matchmaker.cancel_match(ticket_id, sanitize_matchmaking_client_id(clientId))


@app.get("/api/games/{room_id}")
def get_game(room_id: str) -> dict:
    if not ensure_url_room(room_id):
        raise HTTPException(status_code=404, detail="Game not found")
    return store.get_state(room_id)


@app.websocket("/ws/{room_id}")
async def websocket_game(
    websocket: WebSocket,
    room_id: str,
    client_id: str = Query(...),
    name: str = Query("Player"),
    color: str = Query("#1f9a8a"),
) -> None:
    if not ensure_url_room(room_id):
        await websocket.accept()
        await websocket.send_json(
            {"type": "error", "error": {"message": "Game not found.", "code": "room_not_found"}}
        )
        await websocket.close(code=1008)
        return

    await manager.connect(room_id, websocket, client_id, name, color)
    try:
        while True:
            payload = await websocket.receive_json()
            if isinstance(payload, dict):
                await manager.handle_action(room_id, websocket, payload)
            else:
                await websocket.send_json(
                    {"type": "error", "error": {"message": "Expected a JSON object.", "code": "invalid_payload"}}
                )
    except WebSocketDisconnect:
        await manager.disconnect(room_id, websocket)
