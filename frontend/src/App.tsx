import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { cancelStrangerMatch, createPrivateGame, pollStrangerMatch, startStrangerMatch } from "./game/api";
import { getOrCreateIdentity } from "./game/identity";
import type { NormalizedPoint } from "./game/geometry";
import { initialGameUiState, gameUiReducer } from "./game/reducer";
import { useGameSocket } from "./game/useGameSocket";
import { GameCanvas } from "./components/GameCanvas";
import { AnimatedVoronoiCanvas } from "./components/AnimatedVoronoiCanvas";
import { randomPointColor } from "./game/colors";
import { createTessellationBlob } from "./game/tessellation";
import { shareGameLink, shouldShowFirstPlayerSharePrompt } from "./game/share";
import { countPlayerTurns, shouldShowSatisfactionHint } from "./game/turnCue";
import type { PointerKind, ViewportSize } from "./types";

interface TurnCue {
  text: "place" | "wait";
  id: number;
  turnCount: number;
}

type StrangerMatchState = { status: "idle" } | { status: "starting" } | { status: "waiting"; ticketId: string };

const TOPO_URL = "https://www.sanejouand.com/fr/art/jeu-de-topo/index.php";

function App() {
  const [route, setRoute] = useState(() => readRoute());
  const [identity] = useState(() => getOrCreateIdentity());
  const [creatingPrivate, setCreatingPrivate] = useState(false);
  const [shareLabel, setShareLabel] = useState("share game");
  const [finalShareLabel, setFinalShareLabel] = useState("share image");
  const [showHelp, setShowHelp] = useState(false);
  const [strangerMatch, setStrangerMatch] = useState<StrangerMatchState>({ status: "idle" });
  const [dismissedShareRooms, setDismissedShareRooms] = useState<Set<string>>(() => new Set());
  const [dismissedFinalRooms, setDismissedFinalRooms] = useState<Set<string>>(() => new Set());
  const [boardViewport, setBoardViewport] = useState<ViewportSize | null>(null);
  const [finalImage, setFinalImage] = useState<{ blob: Blob; url: string } | null>(null);
  const socket = useGameSocket(route.isPrivate ? route.roomId : null, identity);
  const [ui, dispatch] = useReducer(gameUiReducer, initialGameUiState);
  const [nextColor, setNextColor] = useState(() => randomPointColor());
  const [turnCue, setTurnCue] = useState<TurnCue | null>(null);
  const previousPlayableStatus = useRef<"place" | "wait" | null>(null);
  const lastCursorSentAt = useRef(0);
  const strangerPollAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    dispatch({ type: "connection", status: socket.status });
  }, [socket.status]);

  useEffect(() => {
    if (socket.state) {
      dispatch({ type: "server_state", state: socket.state });
    }
  }, [socket.state]);

  useEffect(() => {
    dispatch({ type: "error", message: socket.error });
  }, [socket.error]);

  useEffect(() => {
    dispatch({ type: "reset" });
    previousPlayableStatus.current = null;
    setTurnCue(null);
    setShareLabel("share game");
    setFinalShareLabel("share image");
    setShowHelp(false);
    setStrangerMatch({ status: "idle" });
    strangerPollAbortRef.current?.abort();
    setBoardViewport(null);
    setFinalImage(null);
  }, [route.roomId]);

  useEffect(() => {
    if (route.isPrivate || strangerMatch.status !== "waiting") {
      return;
    }
    let active = true;
    const controller = new AbortController();
    strangerPollAbortRef.current = controller;

    const poll = async () => {
      while (active) {
        try {
          const result = await pollStrangerMatch(strangerMatch.ticketId, identity.clientId, controller.signal);
          if (!active) {
            return;
          }
          if (result.status === "matched") {
            setStrangerMatch({ status: "idle" });
            navigate(result.url, setRoute);
            dispatch({ type: "set_preview", point: null });
            return;
          }
          if (result.status === "expired") {
            setStrangerMatch({ status: "idle" });
            dispatch({ type: "error", message: "No stranger found. Try again." });
            return;
          }
          if (result.status === "canceled") {
            setStrangerMatch({ status: "idle" });
            return;
          }
        } catch (error) {
          if (!active || isAbortError(error)) {
            return;
          }
          setStrangerMatch({ status: "idle" });
          dispatch({ type: "error", message: "Could not find a stranger." });
          return;
        }
      }
    };

    poll();
    return () => {
      active = false;
      controller.abort();
      if (strangerPollAbortRef.current === controller) {
        strangerPollAbortRef.current = null;
      }
    };
  }, [identity.clientId, route.isPrivate, strangerMatch]);

  const state = ui.server;
  const playerTurnCount = countPlayerTurns(state);
  const me = useMemo(
    () => state?.players.find((player) => player.id === identity.clientId) ?? null,
    [identity.clientId, state?.players]
  );
  const viewTransform = me?.viewTransform ?? "identity";
  const canPlace = Boolean(
    state && !state.room.locked && !state.room.paused && state.room.lastMovePlayerId !== identity.clientId
  );
  const shareUrl = useMemo(() => new URL(route.path, window.location.origin).toString(), [route.path]);
  const statusText = !state || socket.status !== "open"
    ? "connecting"
    : state.room.locked
    ? "game stopped"
    : state.room.paused
      ? me?.ended
        ? "asked everyone to stop"
        : "someone wants to stop"
      : canPlace
        ? "place a point"
        : "wait for another player";
  const playableStatus =
    statusText === "place a point" ? "place" : statusText === "wait for another player" ? "wait" : null;

  useEffect(() => {
    if (!playableStatus) {
      return;
    }
    if (previousPlayableStatus.current && previousPlayableStatus.current !== playableStatus) {
      setTurnCue({ text: playableStatus, id: window.performance.now(), turnCount: playerTurnCount });
    }
    previousPlayableStatus.current = playableStatus;
  }, [playableStatus, playerTurnCount]);

  useEffect(() => {
    if (!route.isPrivate || socket.status !== "open" || !boardViewport) {
      return;
    }
    const timer = window.setTimeout(() => {
      socket.send({ type: "set_viewport", viewport: boardViewport });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [boardViewport?.height, boardViewport?.width, route.isPrivate, socket.send, socket.status]);

  useEffect(() => {
    if (!state?.room.locked || !boardViewport || dismissedFinalRooms.has(route.roomId)) {
      setFinalImage(null);
      return;
    }
    let objectUrl: string | null = null;
    let canceled = false;
    createTessellationBlob(state.points, viewTransform, boardViewport.width, boardViewport.height)
      .then((blob) => {
        if (canceled) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setFinalImage({ blob, url: objectUrl });
      })
      .catch((error) => {
        dispatch({ type: "error", message: error instanceof Error ? error.message : "Could not create image." });
      });
    return () => {
      canceled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [boardViewport, dismissedFinalRooms, route.roomId, state?.points, state?.room.locked, viewTransform]);

  const handleCreatePrivate = async () => {
    if (strangerMatch.status !== "idle") {
      return;
    }
    setCreatingPrivate(true);
    try {
      const game = await createPrivateGame();
      navigate(game.url, setRoute);
      dispatch({ type: "set_preview", point: null });
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : "Could not create game." });
    } finally {
      setCreatingPrivate(false);
    }
  };

  const handlePlayStranger = async () => {
    if (strangerMatch.status !== "idle") {
      return;
    }
    setStrangerMatch({ status: "starting" });
    dispatch({ type: "error", message: null });
    try {
      const result = await startStrangerMatch(identity.clientId);
      if (result.status === "matched") {
        setStrangerMatch({ status: "idle" });
        navigate(result.url, setRoute);
        dispatch({ type: "set_preview", point: null });
      } else if (result.status === "waiting") {
        setStrangerMatch({ status: "waiting", ticketId: result.ticketId });
      } else if (result.status === "expired") {
        setStrangerMatch({ status: "idle" });
        dispatch({ type: "error", message: "No stranger found. Try again." });
      } else {
        setStrangerMatch({ status: "idle" });
      }
    } catch (error) {
      setStrangerMatch({ status: "idle" });
      dispatch({ type: "error", message: error instanceof Error ? error.message : "Could not find a stranger." });
    }
  };

  const handleCancelStranger = async () => {
    if (strangerMatch.status !== "waiting") {
      return;
    }
    const ticketId = strangerMatch.ticketId;
    strangerPollAbortRef.current?.abort();
    setStrangerMatch({ status: "idle" });
    try {
      await cancelStrangerMatch(ticketId, identity.clientId);
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : "Could not cancel matchmaking." });
    }
  };

  const handleShare = async () => {
    try {
      const result = await shareGameLink(window.navigator, shareUrl);
      setShareLabel(result === "shared" ? "shared" : "copied");
    } catch {
      setShareLabel("failed");
    } finally {
      window.setTimeout(() => setShareLabel("share game"), 1400);
    }
  };

  const dismissSharePrompt = () => {
    setDismissedShareRooms((current) => new Set(current).add(route.roomId));
  };

  const dismissFinalPrompt = () => {
    setDismissedFinalRooms((current) => new Set(current).add(route.roomId));
  };

  const handleCursorMove = (point: NormalizedPoint, pointerType: PointerKind) => {
    if (!state || state.room.locked || state.room.paused) {
      return;
    }
    const now = window.performance.now();
    if (now - lastCursorSentAt.current < 35) {
      return;
    }
    lastCursorSentAt.current = now;
    socket.send({ type: "cursor_move", cursor: { ...point, pointerType } });
  };

  const handleCursorClear = () => {
    if (socket.status === "open") {
      socket.send({ type: "cursor_clear" });
    }
  };

  const handleShareFinalImage = async () => {
    if (!finalImage || !state) {
      return;
    }
    const filename = `voronoi-${state.room.id}.png`;
    try {
      const file = new File([finalImage.blob], filename, { type: "image/png" });
      const shareData = {
        title: "Voronoi tessellation",
        text: "This is my tessellation. Other players were probably seeing something very different, but we all agreed this was a satisfying place to stop.",
        files: [file]
      };
      if (navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        setFinalShareLabel("shared");
      } else {
        downloadBlob(finalImage.url, filename);
        setFinalShareLabel("downloaded");
      }
    } catch {
      downloadBlob(finalImage.url, filename);
      setFinalShareLabel("downloaded");
    } finally {
      window.setTimeout(() => setFinalShareLabel("share image"), 1400);
    }
  };

  const commitPoint = (point: NormalizedPoint) => {
    if (!state || !canPlace || state.room.locked) {
      return;
    }
    if (socket.send({ type: "add_point", point: { ...point, color: nextColor } })) {
      setNextColor(randomPointColor());
      dispatch({ type: "set_preview", point: null });
    }
  };

  const askToStop = () => {
    if (!state?.room.locked) {
      socket.send({ type: "vote_end" });
    }
  };

  const keepPlaying = () => {
    if (!state?.room.locked) {
      socket.send({ type: "unvote_end" });
    }
  };
  const showSharePrompt = route.isPrivate
    ? shouldShowFirstPlayerSharePrompt(state, identity.clientId, dismissedShareRooms)
    : false;

  return (
    <main className="appShell">
      <div className="boardFrame">
        {!route.isPrivate ? (
          <AnimatedVoronoiCanvas />
        ) : state ? (
          <GameCanvas
            state={state}
            meId={identity.clientId}
            nextColor={nextColor}
            cursorPoint={ui.preview}
            remoteCursors={state.cursors}
            viewTransform={viewTransform}
            canPlace={canPlace}
            onCursorPoint={(point) => dispatch({ type: "set_preview", point })}
            onCursorMove={handleCursorMove}
            onCursorClear={handleCursorClear}
            onCommitPoint={commitPoint}
            onViewportChange={setBoardViewport}
          />
        ) : (
          <div className="loadingBoard">joining</div>
        )}
      </div>

      <div className="topControls" aria-label="game controls">
        {route.isPrivate ? (
          <button onClick={() => setShowHelp(true)} type="button">
            about
          </button>
        ) : null}
        <button onClick={handleCreatePrivate} disabled={creatingPrivate || strangerMatch.status !== "idle"}>
          {creatingPrivate ? "creating tessellation" : "new tessellation"}
        </button>
        {!route.isPrivate ? (
          <button onClick={handlePlayStranger} disabled={creatingPrivate || strangerMatch.status !== "idle"} type="button">
            {strangerMatch.status === "idle" ? "play with stranger" : "finding stranger"}
          </button>
        ) : null}
        {!route.isPrivate && strangerMatch.status === "waiting" ? (
          <button onClick={handleCancelStranger} type="button">
            cancel
          </button>
        ) : null}
        {route.isPrivate ? (
          <button onClick={handleShare}>{shareLabel === "share game" ? "share this game" : shareLabel}</button>
        ) : null}
        {route.isPrivate && !state?.room.paused ? (
          <EndButton locked={Boolean(state?.room.locked)} disabled={!state} onAskToStop={askToStop} />
        ) : null}
      </div>

      {route.isPrivate && state?.room.paused ? (
        <StopModal ended={Boolean(me?.ended)} onAskToStop={askToStop} onKeepPlaying={keepPlaying} />
      ) : null}

      {showSharePrompt ? (
        <ShareModal label={shareLabel} onShare={handleShare} onDismiss={dismissSharePrompt} />
      ) : null}

      {showHelp ? <HelpModal onDismiss={() => setShowHelp(false)} onHome={() => navigate("/", setRoute)} /> : null}

      {route.isPrivate && state?.room.locked && !dismissedFinalRooms.has(route.roomId) ? (
        <FinalImageModal
          imageUrl={finalImage?.url ?? null}
          label={finalShareLabel}
          onDismiss={dismissFinalPrompt}
          onShare={handleShareFinalImage}
        />
      ) : null}

      {turnCue ? (
        <div
          key={turnCue.id}
          className={`turnCue turnCue-${turnCue.text}`}
          role="status"
          aria-live="polite"
          onAnimationEnd={() => setTurnCue(null)}
        >
          <div className="turnCueCard">
            <span className="turnCuePrimary">{turnCue.text === "wait" ? "please wait" : "your turn"}</span>
            {turnCue.text === "wait" ? (
              <span className="turnCueMessage">another player needs to place before you can add another point</span>
            ) : (
              <span className="turnCueMessage">tap, drag, and release to add your point</span>
            )}
            {turnCue.text === "wait" && shouldShowSatisfactionHint(turnCue.turnCount) ? (
              <span className="turnCueHint">When you like the result, click satisfied - ask to stop.</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {route.isPrivate ? (
        <div className="statusLine" aria-live="polite">
          {statusText}
        </div>
      ) : (
        <aside className="conceptNote" aria-label="Game concept">
          <ConceptCopy />
        </aside>
      )}

      {ui.error ? <div className="errorLine">{ui.error}</div> : null}
    </main>
  );
}

interface EndButtonProps {
  locked: boolean;
  disabled: boolean;
  onAskToStop: () => void;
}

function EndButton({ locked, disabled, onAskToStop }: EndButtonProps) {
  if (locked) {
    return (
      <button disabled type="button">
        game stopped
      </button>
    );
  }
  return (
    <button disabled={disabled} onClick={onAskToStop} type="button">
      satisfied - ask to stop
    </button>
  );
}

interface StopModalProps {
  ended: boolean;
  onAskToStop: () => void;
  onKeepPlaying: () => void;
}

function StopModal({ ended, onAskToStop, onKeepPlaying }: StopModalProps) {
  return (
    <div className="modalBackdrop" role="presentation">
      <section className="stopModal" role="dialog" aria-modal="true" aria-label="Stop game confirmation">
        <p>{ended ? "You asked everyone to stop here." : "A player is satisfied with this result."}</p>
        <div className="modalActions">
          {!ended ? (
            <button onClick={onAskToStop} type="button">
              stop here too
            </button>
          ) : null}
          <button onClick={onKeepPlaying} type="button">
            keep playing
          </button>
        </div>
      </section>
    </div>
  );
}

interface ShareModalProps {
  label: string;
  onShare: () => void;
  onDismiss: () => void;
}

function ShareModal({ label, onShare, onDismiss }: ShareModalProps) {
  return (
    <div className="modalBackdrop shareBackdrop" role="presentation">
      <section className="stopModal shareModal" role="dialog" aria-modal="true" aria-label="Share private game">
        <p>Share this private game.</p>
        <div className="modalActions">
          <button onClick={onDismiss} type="button">
            close
          </button>
          <button className="primaryAction" onClick={onShare} type="button">
            {label}
          </button>
        </div>
      </section>
    </div>
  );
}

interface FinalImageModalProps {
  imageUrl: string | null;
  label: string;
  onShare: () => void;
  onDismiss: () => void;
}

function FinalImageModal({ imageUrl, label, onShare, onDismiss }: FinalImageModalProps) {
  return (
    <div className="modalBackdrop" role="presentation">
      <section className="stopModal finalModal" role="dialog" aria-modal="true" aria-label="Final tessellation">
        <p>
          This is your tessellation. Other players were probably seeing something very different, but they were
          satisfied too.
        </p>
        {imageUrl ? <img alt="Your final Voronoi tessellation" className="finalImagePreview" src={imageUrl} /> : null}
        <div className="modalActions">
          <button onClick={onDismiss} type="button">
            close
          </button>
          <button className="primaryAction" disabled={!imageUrl} onClick={onShare} type="button">
            {imageUrl ? label : "making image"}
          </button>
        </div>
      </section>
    </div>
  );
}

interface HelpModalProps {
  onDismiss: () => void;
  onHome: () => void;
}

function HelpModal({ onDismiss, onHome }: HelpModalProps) {
  return (
    <div className="modalBackdrop" role="presentation">
      <section className="stopModal conceptModal" role="dialog" aria-modal="true" aria-label="About">
        <div className="conceptText">
          <ConceptCopy />
        </div>
        <div className="modalActions">
          <button onClick={onHome} type="button">
            home
          </button>
          <button onClick={onDismiss} type="button">
            close
          </button>
        </div>
      </section>
    </div>
  );
}

function ConceptCopy() {
  return (
    <>
      <p>
        A multiplayer hommage to Jean-Michel Sanejouand&apos;s{" "}
        <a href={TOPO_URL} rel="noreferrer" target="_blank">
          Jeu de Topo (1963)
        </a>
        {", "}
        a game with no winner or loser where partners arrange stones until both points of view are satisfied.
      </p>
      <p>
        Here, stones become colored points in a game based on{" "}
        <a href="https://en.wikipedia.org/wiki/Voronoi_diagram" rel="noreferrer" target="_blank">
          Voronoi diagrams
        </a>
        . The original opposing points of view become each player&apos;s screen: everyone shares the same points, but
        phones, tablets, and browser windows frame the space differently, so each player is likely seeing a different
        Voronoi view.
      </p>
      <p>When two screens are too similar, the game may mirror one board so the points of view diverge.</p>
      <p>
        <a href="https://charlespierre.fr" rel="noreferrer" target="_blank">
          by charlespierre.fr
        </a>
      </p>
    </>
  );
}

function downloadBlob(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function readRoute() {
  const pathname = window.location.pathname;
  const match = pathname.match(/^\/g\/([^/]+)$/);
  if (match) {
    return {
      roomId: decodeURIComponent(match[1]),
      path: pathname,
      isPrivate: true
    };
  }
  return {
    roomId: "",
    path: "/",
    isPrivate: false
  };
}

function navigate(path: string, setRoute: (route: ReturnType<typeof readRoute>) => void) {
  window.history.pushState({}, "", path);
  setRoute(readRoute());
}

export default App;
