import asyncio
from pathlib import Path

from app import main
from app.store import GameStore


def test_url_room_helper_creates_valid_private_room(tmp_path: Path, monkeypatch) -> None:
    store = GameStore(tmp_path / "game.sqlite3")
    store.initialize()
    monkeypatch.setattr(main, "store", store)

    assert main.ensure_url_room("Friends123") is True

    state = store.get_state("Friends123")
    assert state["room"]["id"] == "Friends123"
    assert state["room"]["kind"] == "private"
    assert len(state["points"]) == 8
    assert store.room_exists("Friends123")


def test_url_room_helper_accepts_existing_valid_room(tmp_path: Path, monkeypatch) -> None:
    store = GameStore(tmp_path / "game.sqlite3")
    store.initialize()
    monkeypatch.setattr(main, "store", store)

    assert main.ensure_url_room("Friends456") is True
    assert main.ensure_url_room("Friends456") is True

    assert store.room_exists("Friends456")


def test_invalid_url_room_ids_are_rejected(tmp_path: Path, monkeypatch) -> None:
    store = GameStore(tmp_path / "game.sqlite3")
    store.initialize()
    monkeypatch.setattr(main, "store", store)

    assert main.ensure_url_room("has-dash") is False
    assert main.ensure_url_room("cafeé") is False
    assert main.ensure_url_room("ABCDEFGHIJKLMNOPQRST") is False
    assert not store.room_exists("has-dash")
    assert not store.room_exists("cafeé")
    assert not store.room_exists("ABCDEFGHIJKLMNOPQRST")


def test_similar_viewports_get_distinct_transforms() -> None:
    presences = {
        "alice": main.PlayerPresence(viewport=main.Viewport(width=390, height=844), view_transform="identity"),
        "bob": main.PlayerPresence(viewport=main.Viewport(width=393, height=852), view_transform="identity"),
        "carol": main.PlayerPresence(viewport=main.Viewport(width=844, height=390), view_transform="identity"),
    }

    presences["alice"].view_transform = main.choose_view_transform("alice", presences)
    presences["bob"].view_transform = main.choose_view_transform("bob", presences)
    presences["carol"].view_transform = main.choose_view_transform("carol", presences)

    assert main.viewports_are_similar(presences["alice"].viewport, presences["bob"].viewport)
    assert not main.viewports_are_similar(presences["alice"].viewport, presences["carol"].viewport)
    assert presences["alice"].view_transform == "identity"
    assert presences["bob"].view_transform == "flipX"
    assert presences["carol"].view_transform == "identity"


def test_enrich_state_adds_ephemeral_cursor_and_transform(tmp_path: Path) -> None:
    store = GameStore(tmp_path / "game.sqlite3")
    store.initialize()
    room_id = store.create_private_room()
    store.upsert_player(room_id, "alice", "Alice", "#111111")
    state = store.get_state(room_id, {"alice"})

    main.enrich_state_with_presence(
        state,
        {
            "alice": main.PlayerPresence(
                view_transform="flipY",
                cursor=main.CursorPresence(x=0.2, y=0.8, pointer_type="touch", updated_at=1234),
            )
        },
    )

    assert state["players"][0]["viewTransform"] == "flipY"
    assert state["cursors"] == [
        {
            "playerId": "alice",
            "name": "Alice",
            "color": "#111111",
            "x": 0.2,
            "y": 0.8,
            "pointerType": "touch",
            "updatedAt": 1234,
        }
    ]

    reloaded = GameStore(tmp_path / "game.sqlite3")
    reloaded.initialize()
    persisted_state = reloaded.get_state(room_id, {"alice"})

    assert persisted_state["players"][0]["viewTransform"] == "identity"
    assert persisted_state["cursors"] == []


def test_locked_room_can_have_viewport_transform_assigned(tmp_path: Path) -> None:
    store = GameStore(tmp_path / "game.sqlite3")
    store.initialize()
    room_id = store.create_private_room()
    store.upsert_player(room_id, "alice", "Alice", "#111111")
    store.upsert_player(room_id, "bob", "Bob", "#222222")
    store.vote_end(room_id, "alice")
    store.vote_end(room_id, "bob")
    store.maybe_lock(room_id, {"alice", "bob"})

    state = store.get_state(room_id, {"alice", "bob"})
    presence = {
        "alice": main.PlayerPresence(viewport=main.Viewport(width=390, height=844)),
        "bob": main.PlayerPresence(viewport=main.Viewport(width=393, height=852)),
    }
    presence["alice"].view_transform = main.choose_view_transform("alice", presence)
    presence["bob"].view_transform = main.choose_view_transform("bob", presence)
    main.enrich_state_with_presence(state, presence)

    assert state["room"]["locked"] is True
    assert [player["viewTransform"] for player in state["players"]] == ["identity", "flipX"]


def test_cursor_state_clears_without_persistence(tmp_path: Path) -> None:
    store = GameStore(tmp_path / "game.sqlite3")
    store.initialize()
    room_id = store.create_private_room()
    store.upsert_player(room_id, "alice", "Alice", "#111111")
    manager = main.ConnectionManager(store)

    asyncio.run(
        manager.set_cursor(
            room_id,
            "alice",
            main.CursorPresence(x=0.5, y=0.25, pointer_type="mouse", updated_at=1234),
        )
    )
    assert manager._presence[room_id]["alice"].cursor is not None

    asyncio.run(manager.clear_cursor(room_id, "alice"))

    assert manager._presence[room_id]["alice"].cursor is None
    assert store.get_state(room_id, {"alice"})["cursors"] == []
