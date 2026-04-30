from pathlib import Path

import pytest

from app.store import GameError, GameStore, is_valid_private_room_id


def make_store(tmp_path: Path) -> GameStore:
    store = GameStore(tmp_path / "game.sqlite3")
    store.initialize()
    return store


def add_players(store: GameStore, room_id: str) -> None:
    store.upsert_player(room_id, "alice", "Alice", "#1f9a8a")
    store.upsert_player(room_id, "bob", "Bob", "#e25d47")


def test_private_room_persists_after_reopen(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    room_id = store.create_private_room()
    assert is_valid_private_room_id(room_id)
    store.upsert_player(room_id, "alice", "Alice", "#1f9a8a")
    store.add_point(room_id, "alice", 0.25, 0.75, "#abcdef")

    reopened = GameStore(tmp_path / "game.sqlite3")
    reopened.initialize()
    state = reopened.get_state(room_id)

    assert state["room"]["kind"] == "private"
    assert len(state["points"]) == 9
    assert state["points"][-1] == {
        "id": state["points"][-1]["id"],
        "ownerId": "alice",
        "color": "#abcdef",
        "x": 0.25,
        "y": 0.75,
    }
    assert state["players"][0]["name"] == "Alice"


def test_rooms_start_with_eight_seed_points(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    room_id = store.create_private_room()

    state = store.get_state(room_id)

    assert len(state["points"]) == 8
    assert {point["ownerId"] for point in state["points"]} == {"__seed__"}
    assert all(point["color"].startswith("#") for point in state["points"])


def test_initialize_does_not_create_public_room(tmp_path: Path) -> None:
    store = make_store(tmp_path)

    assert store.room_exists("public-v4") is False


def test_rejects_only_the_last_player_to_place(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    room_id = store.create_private_room()
    add_players(store, room_id)

    store.add_point(room_id, "alice", 0.2, 0.3, "#111111")

    with pytest.raises(GameError, match="twice in a row"):
        store.add_point(room_id, "alice", 0.3, 0.4, "#222222")

    store.add_point(room_id, "bob", 0.3, 0.4, "#222222")
    store.add_point(room_id, "alice", 0.4, 0.5, "#333333")
    state = store.get_state(room_id, {"alice", "bob"})

    assert state["room"]["lastMovePlayerId"] == "alice"
    assert [point["ownerId"] for point in state["points"][-3:]] == ["alice", "bob", "alice"]


def test_newly_joined_player_can_place_after_last_mover(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    room_id = store.create_private_room()
    store.upsert_player(room_id, "alice", "Alice", "#1f9a8a")
    store.add_point(room_id, "alice", 0.2, 0.3, "#111111")

    store.upsert_player(room_id, "bob", "Bob", "#e25d47")
    store.add_point(room_id, "bob", 0.3, 0.4, "#222222")

    state = store.get_state(room_id, {"alice", "bob"})
    assert state["room"]["lastMovePlayerId"] == "bob"
    assert [point["ownerId"] for point in state["points"][-2:]] == ["alice", "bob"]


def test_points_are_fixed_once_placed(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    room_id = store.create_private_room()
    add_players(store, room_id)

    point_id = store.add_point(room_id, "alice", 0.2, 0.3, "#111111")

    with pytest.raises(GameError, match="fixed once placed"):
        store.move_point(room_id, "alice", point_id, 0.5, 0.5)

    with pytest.raises(GameError, match="fixed once placed"):
        store.delete_point(room_id, "alice", point_id)


def test_players_can_join_locked_room_state(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    room_id = store.create_private_room()
    add_players(store, room_id)
    store.vote_end(room_id, "alice")
    store.vote_end(room_id, "bob")
    store.maybe_lock(room_id, {"alice", "bob"})

    store.upsert_player(room_id, "carol", "Carol", "#4078d4")
    state = store.get_state(room_id, {"alice", "bob", "carol"})

    assert state["room"]["locked"] is True
    assert state["players"][-1]["id"] == "carol"
    assert state["players"][-1]["connected"] is True


def test_satisfaction_vote_pauses_until_someone_keeps_playing(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    room_id = store.create_private_room()
    add_players(store, room_id)
    store.vote_end(room_id, "alice")

    paused_state = store.get_state(room_id, {"alice", "bob"})

    assert paused_state["room"]["paused"] is True
    assert paused_state["endedPlayerIds"] == ["alice"]
    with pytest.raises(GameError, match="paused"):
        store.add_point(room_id, "bob", 0.45, 0.35, "#333333")

    store.unvote_end(room_id, "bob")
    resumed_state = store.get_state(room_id, {"alice", "bob"})

    assert resumed_state["room"]["paused"] is False
    assert resumed_state["endedPlayerIds"] == []
    store.add_point(room_id, "bob", 0.45, 0.35, "#333333")


def test_room_locks_when_all_connected_players_vote_to_end(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    room_id = store.create_private_room()
    add_players(store, room_id)
    store.vote_end(room_id, "alice")

    assert store.maybe_lock(room_id, {"alice", "bob"}) is False
    assert store.get_state(room_id)["room"]["locked"] is False

    store.vote_end(room_id, "bob")

    assert store.maybe_lock(room_id, {"alice", "bob"}) is True
    assert store.get_state(room_id)["room"]["locked"] is True


def test_rejects_point_changes_after_lock(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    room_id = store.create_private_room()
    add_players(store, room_id)
    store.vote_end(room_id, "alice")
    store.vote_end(room_id, "bob")
    store.maybe_lock(room_id, {"alice", "bob"})

    with pytest.raises(GameError, match="game has ended"):
        store.add_point(room_id, "alice", 0.1, 0.1, "#444444")
