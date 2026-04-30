from __future__ import annotations

import secrets
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable

PRIVATE_ROOM_ID_MAX_LENGTH = 19
SEED_OWNER_ID = "__seed__"
POINT_COLORS = (
    "#ff477e",
    "#00bbf9",
    "#fee440",
    "#00f5d4",
    "#9b5de5",
    "#f15bb5",
    "#80ed99",
    "#f8961e",
)


class GameError(Exception):
    def __init__(self, message: str, code: str = "bad_request") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def default_database_path() -> Path:
    return Path(__file__).resolve().parents[1] / "data" / "voronoi.sqlite3"


def is_valid_private_room_id(room_id: str) -> bool:
    return 0 < len(room_id) <= PRIVATE_ROOM_ID_MAX_LENGTH and all(
        char.isascii() and char.isalnum() for char in room_id
    )


class GameStore:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = Path(db_path) if db_path else default_database_path()
        self._lock = threading.RLock()

    def initialize(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS rooms (
                  id TEXT PRIMARY KEY,
                  kind TEXT NOT NULL CHECK (kind IN ('public', 'private')),
                  locked INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS players (
                  room_id TEXT NOT NULL,
                  id TEXT NOT NULL,
                  name TEXT NOT NULL,
                  color TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (room_id, id),
                  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS points (
                  id TEXT PRIMARY KEY,
                  room_id TEXT NOT NULL,
                  owner_id TEXT NOT NULL,
                  color TEXT NOT NULL DEFAULT '#8b7bd6',
                  x REAL NOT NULL,
                  y REAL NOT NULL,
                  created_at TEXT NOT NULL,
                  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS end_votes (
                  room_id TEXT NOT NULL,
                  player_id TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY (room_id, player_id),
                  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
                );
                """
            )
            self._migrate(conn)

    def create_private_room(self) -> str:
        with self._lock:
            for _ in range(10):
                room_id = "".join(char for char in secrets.token_urlsafe(12) if char.isalnum())[
                    :PRIVATE_ROOM_ID_MAX_LENGTH
                ]
                if not is_valid_private_room_id(room_id):
                    continue
                try:
                    with self._connect() as conn:
                        conn.execute(
                            """
                            INSERT INTO rooms (id, kind, locked, created_at)
                            VALUES (?, 'private', 0, ?)
                            """,
                            (room_id, utc_now()),
                        )
                        self._seed_room_if_empty(conn, room_id)
                    return room_id
                except sqlite3.IntegrityError:
                    continue
        raise GameError("Could not create a unique game URL.", "room_creation_failed")

    def ensure_room(self, room_id: str, kind: str) -> None:
        if kind != "private":
            raise GameError("Invalid room type.", "invalid_room_type")
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO rooms (id, kind, locked, created_at)
                VALUES (?, ?, 0, ?)
                ON CONFLICT(id) DO NOTHING
                """,
                (room_id, kind, utc_now()),
            )
            self._seed_room_if_empty(conn, room_id)

    def room_exists(self, room_id: str) -> bool:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT 1 FROM rooms WHERE id = ?", (room_id,)).fetchone()
            return row is not None

    def upsert_player(self, room_id: str, player_id: str, name: str, color: str) -> None:
        self._require_room(room_id)
        safe_name = name.strip()[:36] or "Player"
        safe_color = color.strip()[:24] or "#1f9a8a"
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO players (room_id, id, name, color, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(room_id, id) DO UPDATE SET
                  name = excluded.name,
                  color = excluded.color,
                  updated_at = excluded.updated_at
                """,
                (room_id, player_id, safe_name, safe_color, utc_now()),
            )

    def set_name(self, room_id: str, player_id: str, name: str) -> None:
        safe_name = name.strip()[:36] or "Player"
        with self._lock, self._connect() as conn:
            self._require_player(conn, room_id, player_id)
            conn.execute(
                """
                UPDATE players
                SET name = ?, updated_at = ?
                WHERE room_id = ? AND id = ?
                """,
                (safe_name, utc_now(), room_id, player_id),
            )

    def add_point(
        self,
        room_id: str,
        owner_id: str,
        x: float,
        y: float,
        color: str | None = None,
    ) -> str:
        self._validate_coordinate(x, y)
        with self._lock, self._connect() as conn:
            self._assert_mutable(conn, room_id)
            self._require_player(conn, room_id, owner_id)
            if self._is_paused(conn, room_id):
                raise GameError("Game is paused while players decide whether to stop.", "game_paused")
            last_move_player_id = self._last_move_player_id(conn, room_id)
            if last_move_player_id == owner_id:
                raise GameError("You cannot place twice in a row.", "repeat_move")
            point_id = f"pt_{secrets.token_urlsafe(10)}"
            point_color = self._safe_color(color)
            conn.execute(
                """
                INSERT INTO points (id, room_id, owner_id, color, x, y, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (point_id, room_id, owner_id, point_color, x, y, utc_now()),
            )
            self._clear_votes(conn, room_id)
            return point_id

    def move_point(self, room_id: str, player_id: str, point_id: str, x: float, y: float) -> None:
        raise GameError("Points are fixed once placed.", "points_fixed")

    def delete_point(self, room_id: str, player_id: str, point_id: str) -> None:
        raise GameError("Points are fixed once placed.", "points_fixed")

    def vote_end(self, room_id: str, player_id: str) -> None:
        with self._lock, self._connect() as conn:
            self._assert_mutable(conn, room_id)
            self._require_player(conn, room_id, player_id)
            conn.execute(
                """
                INSERT INTO end_votes (room_id, player_id, created_at)
                VALUES (?, ?, ?)
                ON CONFLICT(room_id, player_id) DO NOTHING
                """,
                (room_id, player_id, utc_now()),
            )

    def unvote_end(self, room_id: str, player_id: str) -> None:
        with self._lock, self._connect() as conn:
            self._assert_mutable(conn, room_id)
            self._require_player(conn, room_id, player_id)
            self._clear_votes(conn, room_id)

    def maybe_lock(self, room_id: str, connected_player_ids: Iterable[str]) -> bool:
        connected = set(connected_player_ids)
        if not connected:
            return False
        with self._lock, self._connect() as conn:
            room = self._room(conn, room_id)
            if bool(room["locked"]):
                return True
            votes = {
                row["player_id"]
                for row in conn.execute(
                    "SELECT player_id FROM end_votes WHERE room_id = ?",
                    (room_id,),
                ).fetchall()
            }
            if connected.issubset(votes):
                conn.execute("UPDATE rooms SET locked = 1 WHERE id = ?", (room_id,))
                return True
            return False

    def get_state(self, room_id: str, connected_player_ids: Iterable[str] = ()) -> dict:
        connected = set(connected_player_ids)
        with self._lock, self._connect() as conn:
            room = self._room(conn, room_id)
            vote_rows = conn.execute(
                "SELECT player_id FROM end_votes WHERE room_id = ?",
                (room_id,),
            ).fetchall()
            ended_ids = {row["player_id"] for row in vote_rows}
            points = [
                {
                    "id": row["id"],
                    "ownerId": row["owner_id"],
                    "color": row["color"],
                    "x": row["x"],
                    "y": row["y"],
                }
                for row in conn.execute(
                    """
                    SELECT id, owner_id, color, x, y
                    FROM points
                    WHERE room_id = ?
                    ORDER BY created_at ASC
                    """,
                    (room_id,),
                ).fetchall()
            ]
            point_counts: dict[str, int] = {}
            for point in points:
                point_counts[point["ownerId"]] = point_counts.get(point["ownerId"], 0) + 1
            players = [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "color": row["color"],
                    "connected": row["id"] in connected,
                    "ended": row["id"] in ended_ids,
                    "pointsCount": point_counts.get(row["id"], 0),
                    "viewTransform": "identity",
                }
                for row in conn.execute(
                    """
                    SELECT id, name, color
                    FROM players
                    WHERE room_id = ?
                    ORDER BY updated_at ASC
                    """,
                    (room_id,),
                ).fetchall()
            ]
            return {
                "room": {
                    "id": row_id(room),
                    "kind": room["kind"],
                    "locked": bool(room["locked"]),
                    "paused": bool(ended_ids) and not bool(room["locked"]),
                    "lastMovePlayerId": self._last_move_player_id(conn, room_id),
                },
                "players": players,
                "points": points,
                "cursors": [],
                "endedPlayerIds": sorted(ended_ids),
                "connectedPlayerIds": sorted(connected),
            }

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _migrate(self, conn: sqlite3.Connection) -> None:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(points)").fetchall()}
        if "color" not in columns:
            conn.execute("ALTER TABLE points ADD COLUMN color TEXT NOT NULL DEFAULT '#8b7bd6'")

    def _require_room(self, room_id: str) -> None:
        with self._connect() as conn:
            self._room(conn, room_id)

    def _room(self, conn: sqlite3.Connection, room_id: str) -> sqlite3.Row:
        row = conn.execute(
            "SELECT id, kind, locked FROM rooms WHERE id = ?",
            (room_id,),
        ).fetchone()
        if row is None:
            raise GameError("Game not found.", "room_not_found")
        return row

    def _assert_mutable(self, conn: sqlite3.Connection, room_id: str) -> None:
        room = self._room(conn, room_id)
        if bool(room["locked"]):
            raise GameError("This game has ended. No more points can be changed.", "room_locked")

    def _require_player(self, conn: sqlite3.Connection, room_id: str, player_id: str) -> None:
        row = conn.execute(
            "SELECT 1 FROM players WHERE room_id = ? AND id = ?",
            (room_id, player_id),
        ).fetchone()
        if row is None:
            raise GameError("Player is not in this game.", "player_not_found")

    def _require_point_owner(
        self,
        conn: sqlite3.Connection,
        room_id: str,
        player_id: str,
        point_id: str,
    ) -> None:
        row = conn.execute(
            "SELECT owner_id FROM points WHERE room_id = ? AND id = ?",
            (room_id, point_id),
        ).fetchone()
        if row is None:
            raise GameError("Point not found.", "point_not_found")
        if row["owner_id"] != player_id:
            raise GameError("Only the point owner can change that point.", "not_point_owner")

    def _clear_votes(self, conn: sqlite3.Connection, room_id: str) -> None:
        conn.execute("DELETE FROM end_votes WHERE room_id = ?", (room_id,))

    def _is_paused(self, conn: sqlite3.Connection, room_id: str) -> bool:
        row = conn.execute(
            "SELECT 1 FROM end_votes WHERE room_id = ? LIMIT 1",
            (room_id,),
        ).fetchone()
        return row is not None

    def _validate_coordinate(self, x: float, y: float) -> None:
        if not (0 <= x <= 1 and 0 <= y <= 1):
            raise GameError("Point coordinates must be between 0 and 1.", "invalid_point")

    def _safe_color(self, color: str | None) -> str:
        if color and len(color) == 7 and color.startswith("#"):
            try:
                int(color[1:], 16)
                return color.lower()
            except ValueError:
                pass
        return POINT_COLORS[secrets.randbelow(len(POINT_COLORS))]

    def _seed_room_if_empty(self, conn: sqlite3.Connection, room_id: str) -> None:
        count = conn.execute("SELECT COUNT(*) AS count FROM points WHERE room_id = ?", (room_id,)).fetchone()["count"]
        if count:
            return
        now = utc_now()
        for index in range(8):
            x = 0.09 + secrets.randbelow(8200) / 10000
            y = 0.09 + secrets.randbelow(8200) / 10000
            color = POINT_COLORS[(index + secrets.randbelow(len(POINT_COLORS))) % len(POINT_COLORS)]
            conn.execute(
                """
                INSERT INTO points (id, room_id, owner_id, color, x, y, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (f"seed_{secrets.token_urlsafe(8)}", room_id, SEED_OWNER_ID, color, x, y, now),
            )

    def _last_move_player_id(self, conn: sqlite3.Connection, room_id: str) -> str | None:
        row = conn.execute(
            """
            SELECT owner_id
            FROM points
            WHERE room_id = ? AND owner_id != ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (room_id, SEED_OWNER_ID),
        ).fetchone()
        return None if row is None else str(row["owner_id"])


def row_id(row: sqlite3.Row) -> str:
    return str(row["id"])
