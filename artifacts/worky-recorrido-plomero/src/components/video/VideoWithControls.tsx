import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, Repeat, Volume2, VolumeX } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import { useSceneControls } from './useSceneControls';

const SCENE_DETAILS = [
  { title: 'El problema', filePath: 'src/components/video/JourneyScenes.tsx' },
  { title: 'Publicar un pedido', filePath: 'src/components/video/JourneyScenes.tsx' },
  { title: 'Encontrar profesionales', filePath: 'src/components/video/JourneyScenes.tsx' },
  { title: 'Elegir con confianza', filePath: 'src/components/video/JourneyScenes.tsx' },
  { title: 'Chat y visita', filePath: 'src/components/video/JourneyScenes.tsx' },
  { title: 'Trabajo y pago', filePath: 'src/components/video/JourneyScenes.tsx' },
  { title: 'Cierre Worky', filePath: 'src/components/video/JourneyScenes.tsx' },
];

function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function PlaybackBar({
  sceneKeys, activeIndex, activeDuration, activeStartTime, totalDuration, tick, paused,
  onJump,
}: {
  sceneKeys: string[];
  activeIndex: number;
  activeDuration: number;
  activeStartTime: number;
  totalDuration: number;
  tick: number;
  paused: boolean;
  onJump: (index: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const elapsedBase = useRef(0);
  useEffect(() => {
    setElapsed(0);
    elapsedBase.current = 0;
  }, [tick]);
  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    const id = window.setInterval(() => setElapsed(elapsedBase.current + performance.now() - start), 60);
    return () => {
      window.clearInterval(id);
      elapsedBase.current += performance.now() - start;
    };
  }, [tick, paused]);
  const progress = activeDuration ? Math.min(1, elapsed / activeDuration) : 0;
  const totalElapsed = Math.min(totalDuration, activeStartTime + Math.min(elapsed, activeDuration));
  return (
    <>
      <div className="film-segments">
        {sceneKeys.map((key, index) => (
          <button key={key} className="film-segment" onClick={() => onJump(index)} aria-label={`Ir a escena ${index + 1}`} aria-current={index === activeIndex}>
            <span style={{ width: `${index < activeIndex ? 100 : index === activeIndex ? progress * 100 : 0}%` }} />
          </button>
        ))}
      </div>
      <span className="film-count">{activeIndex + 1}/{sceneKeys.length}</span>
      <span className="film-time">{formatTime(totalElapsed)} / {formatTime(totalDuration)}</span>
    </>
  );
}

export default function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);
  const sensorRef = useRef<HTMLDivElement | null>(null);
  const {
    sceneKeys, activeIndex, locked, paused, muted, mountKey, tick, durations,
    activeDuration, activeStartTime, totalDuration, onSceneChange, jumpTo,
    toggleLock, togglePause, toggleMute,
  } = useSceneControls(SCENE_DURATIONS);

  const handleJump = useCallback((index: number) => {
    jumpTo(index);
    const details = SCENE_DETAILS[index];
    if (details) window.parent.postMessage({
      type: 'REPLIT_VIDEO_SCENE_SELECTED',
      payload: { sceneIndex: index, sceneCount: sceneKeys.length, sceneTitle: details.title, filePath: details.filePath, lineNumber: 1 },
    }, '*');
  }, [jumpTo, sceneKeys.length]);

  useEffect(() => {
    if (!paused) return;
    const animations = document.getAnimations().filter((animation) => animation.playState === 'running');
    animations.forEach((animation) => animation.pause());
    return () => animations.forEach((animation) => animation.play());
  }, [paused]);
  useEffect(() => {
    if (!(collapsed && tapPinned)) return;
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && sensorRef.current && !sensorRef.current.contains(event.target as Node)) setTapPinned(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [collapsed, tapPinned]);

  if (!isIframed) return <VideoTemplate />;
  const visible = !collapsed || hovering || tapPinned;
  return (
    <div className="relative w-full h-screen">
      <VideoTemplate
        key={mountKey}
        durations={durations}
        loop
        paused={paused}
        muted={muted}
        onSceneChange={onSceneChange}
      />
      <div
        ref={sensorRef}
        className="film-control-sensor"
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHovering(true); }}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHovering(false); }}
        onPointerDown={(event) => { if (event.pointerType !== 'mouse' && collapsed) setTapPinned(true); }}
      >
        <div className="film-control-filler" aria-hidden="true" />
        <div className={`film-control-bar ${visible ? 'is-visible' : ''}`} aria-hidden={!visible}>
          <button className="film-control-icon" onClick={togglePause} title={paused ? 'Reproducir' : 'Pausar'} aria-label={paused ? 'Reproducir' : 'Pausar'}>{paused ? <Play /> : <Pause />}</button>
          <button className={`film-control-icon ${locked ? 'is-active' : ''}`} onClick={toggleLock} title={locked ? 'Repetir escena: activado' : 'Repetir escena: desactivado'} aria-label="Repetir escena actual" aria-pressed={locked}><Repeat /></button>
          <button className="film-control-icon" onClick={toggleMute} title={muted ? 'Activar sonido' : 'Silenciar'} aria-label={muted ? 'Activar sonido' : 'Silenciar'}>{muted ? <VolumeX /> : <Volume2 />}</button>
          <div className="film-divider" />
          <PlaybackBar
            sceneKeys={sceneKeys}
            activeIndex={activeIndex}
            activeDuration={activeDuration}
            activeStartTime={activeStartTime}
            totalDuration={totalDuration}
            tick={tick}
            paused={paused}
            onJump={handleJump}
          />
          <button
            className="film-control-icon collapse-icon"
            onClick={() => setCollapsed((value) => { if (!value) { setHovering(false); setTapPinned(false); } return !value; })}
            title={collapsed ? 'Mostrar controles' : 'Ocultar controles'}
            aria-label={collapsed ? 'Mostrar controles' : 'Ocultar controles'}
            aria-expanded={!collapsed}
          >{collapsed ? <ChevronUp /> : <ChevronDown />}</button>
        </div>
      </div>
    </div>
  );
}
