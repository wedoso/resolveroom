import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';

const FOREST = '#173f32';
const INK = '#17211d';
const PAPER = '#f8f7f3';
const MUTED = '#5f6e67';
const SAGE = '#cfe1d4';
const GOLD = '#f0e4b8';
const SCENE_DURATION = 120;
const INTRO_DURATION = 105;
const OUTRO_DURATION = 105;
const TRANSITION_DURATION = 15;
const SCREEN_COUNT = 6;
export const WALKTHROUGH_DURATION =
  INTRO_DURATION +
  SCREEN_COUNT * SCENE_DURATION +
  OUTRO_DURATION -
  (SCREEN_COUNT + 1) * TRANSITION_DURATION;

type Scene = {
  image: string;
  eyebrow: string;
  title: string;
  body: string;
};

const scenes: Scene[] = [
  {
    image: 'resolveroom-overview.jpg',
    eyebrow: '01 · START PRIVATE',
    title: 'A calm place for structured disagreement.',
    body: 'Two people define one conflict. Nothing is publicly listed, and the protocol stays finite.',
  },
  {
    image: 'resolveroom-dashboard.jpg',
    eyebrow: '02 · STAY ORIENTED',
    title: 'See every case and what needs attention.',
    body: 'The dashboard groups active, waiting, resolved, cancelled, and expired conflicts around the next useful action.',
  },
  {
    image: 'resolveroom-private-brief.jpg',
    eyebrow: '03 · BRIEF PRIVATELY',
    title: 'Each side briefs only its own agent.',
    body: 'Goals, priorities, compromises, and notes never enter the opponent view or the Judge record.',
  },
  {
    image: 'resolveroom-conflict-room.jpg',
    eyebrow: '04 · WATCH IT WORK',
    title: 'Agents complete a live, finite protocol.',
    body: 'Opening, rebuttal, and closing turns are enforced server-side and persisted as an append-only record.',
  },
  {
    image: 'resolveroom-verdict.jpg',
    eyebrow: '05 · REACH AN OUTCOME',
    title: 'The Judge returns a validated advisory verdict.',
    body: 'A structured assessment explains the deciding points, scores both cases, and clearly states its limits.',
  },
  {
    image: 'resolveroom-share-view.jpg',
    eyebrow: '06 · SHARE SAFELY',
    title: 'Publish only a permission-filtered observer view.',
    body: 'Unlisted links are read-only and revocable. Private briefs, credentials, and private events stay out.',
  },
];

const Grid = () => (
  <AbsoluteFill
    style={{
      backgroundImage:
        'linear-gradient(rgba(23,33,29,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(23,33,29,.07) 1px, transparent 1px)',
      backgroundSize: '120px 120px',
    }}
  />
);

const Mark = ({ light = false }: { light?: boolean }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
    <div
      style={{
        width: 46,
        height: 46,
        border: `2px solid ${light ? SAGE : FOREST}`,
        display: 'grid',
        placeItems: 'center',
        fontSize: 25,
        fontWeight: 700,
      }}
    >
      ↳
    </div>
    <div
      style={{ fontSize: 27, fontWeight: 750, letterSpacing: -0.8, color: light ? '#fffefa' : INK }}
    >
      ResolveRoom
    </div>
  </div>
);

const introProgress = (frame: number) =>
  interpolate(frame, [0, 30], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const Intro = () => {
  const frame = useCurrentFrame();
  const enter = introProgress(frame);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: PAPER,
        color: INK,
        fontFamily: 'Inter, Arial, sans-serif',
        padding: '86px 104px',
      }}
    >
      <Grid />
      <div style={{ position: 'relative' }}>
        <Mark />
      </div>
      <div
        style={{
          position: 'relative',
          marginTop: 164,
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [46, 0])}px)`,
          width: 1370,
        }}
      >
        <div
          style={{
            color: FOREST,
            fontFamily: 'monospace',
            fontSize: 20,
            letterSpacing: 5,
            marginBottom: 28,
          }}
        >
          PRIVATE · AGENT-NATIVE · STRUCTURED
        </div>
        <div style={{ fontSize: 96, lineHeight: 0.98, letterSpacing: -5.8, fontWeight: 760 }}>
          Give your side to your agent.
          <br />
          <span style={{ color: FOREST }}>Let them work it out.</span>
        </div>
        <div
          style={{ marginTop: 40, fontSize: 30, color: MUTED, maxWidth: 1060, lineHeight: 1.45 }}
        >
          A 28-second tour of the complete ResolveRoom workflow.
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 104,
          bottom: 80,
          padding: '16px 24px',
          background: SAGE,
          color: FOREST,
          fontFamily: 'monospace',
          fontSize: 18,
          letterSpacing: 2,
        }}
      >
        DEBATE · PERSUASION · REALTIME
      </div>
    </AbsoluteFill>
  );
};

const ScreenshotScene = ({ scene, index }: { scene: Scene; index: number }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 35], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const imageX = interpolate(enter, [0, 1], [80, 0]);
  const imageScale = interpolate(frame, [0, SCENE_DURATION], [0.985, 1.015], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: PAPER,
        color: INK,
        fontFamily: 'Inter, Arial, sans-serif',
        overflow: 'hidden',
      }}
    >
      <Grid />
      <div style={{ position: 'absolute', left: 82, top: 62 }}>
        <Mark />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 82,
          top: 270,
          width: 410,
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [32, 0])}px)`,
        }}
      >
        <div
          style={{
            color: FOREST,
            fontFamily: 'monospace',
            fontSize: 18,
            letterSpacing: 3.4,
            marginBottom: 25,
          }}
        >
          {scene.eyebrow}
        </div>
        <div style={{ fontSize: 52, lineHeight: 1.03, letterSpacing: -2.5, fontWeight: 750 }}>
          {scene.title}
        </div>
        <div style={{ marginTop: 30, fontSize: 24, lineHeight: 1.5, color: MUTED }}>
          {scene.body}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 540,
          top: 94,
          width: 1320,
          height: 742,
          background: '#fffefa',
          border: '1px solid rgba(23,33,29,.24)',
          boxShadow: '0 32px 90px rgba(23,33,29,.18)',
          overflow: 'hidden',
          opacity: enter,
          transform: `translateX(${imageX}px) scale(${imageScale})`,
          transformOrigin: 'center',
        }}
      >
        <div
          style={{
            height: 42,
            borderBottom: '1px solid rgba(23,33,29,.14)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 18px',
            background: '#fffefa',
          }}
        >
          {[SAGE, GOLD, '#d7e3ea'].map((color) => (
            <div
              key={color}
              style={{ width: 11, height: 11, borderRadius: 99, background: color }}
            />
          ))}
          <div style={{ marginLeft: 12, fontFamily: 'monospace', fontSize: 13, color: MUTED }}>
            app.resolveroom.example
          </div>
        </div>
        <Img
          src={staticFile(scene.image)}
          style={{ width: '100%', height: 700, objectFit: 'cover', objectPosition: 'top' }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 82,
          right: 82,
          bottom: 64,
          height: 2,
          background: 'rgba(23,33,29,.15)',
        }}
      >
        <div
          style={{
            width: `${((index + 1) / SCREEN_COUNT) * 100}%`,
            height: '100%',
            background: FOREST,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const Outro = () => {
  const frame = useCurrentFrame();
  const enter = introProgress(frame);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: FOREST,
        color: '#fffefa',
        fontFamily: 'Inter, Arial, sans-serif',
        padding: '86px 104px',
      }}
    >
      <div style={{ opacity: 0.12 }}>
        <Grid />
      </div>
      <div style={{ position: 'relative', color: '#fffefa' }}>
        <Mark light />
      </div>
      <div
        style={{
          position: 'relative',
          marginTop: 180,
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [42, 0])}px)`,
        }}
      >
        <div style={{ fontSize: 92, lineHeight: 1, letterSpacing: -5, fontWeight: 760 }}>
          Structured conflict.
          <br />
          <span style={{ color: SAGE }}>Transparent outcomes.</span>
        </div>
        <div style={{ marginTop: 42, fontSize: 29, lineHeight: 1.5, color: '#dbe7df' }}>
          Debate and persuasion · Private briefs · Realtime rooms · Revocable sharing
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 104,
          bottom: 76,
          fontFamily: 'monospace',
          fontSize: 20,
          letterSpacing: 3,
          color: SAGE,
        }}
      >
        PRODUCTION-READY V0
      </div>
    </AbsoluteFill>
  );
};

const transition = (key: string) => (
  <TransitionSeries.Transition
    key={key}
    presentation={fade()}
    timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
  />
);

export const ResolveRoomWalkthrough = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={INTRO_DURATION}>
      <Intro />
    </TransitionSeries.Sequence>
    {scenes.flatMap((scene, index) => [
      transition(`transition-${scene.image}`),
      <TransitionSeries.Sequence key={scene.image} durationInFrames={SCENE_DURATION}>
        <ScreenshotScene scene={scene} index={index} />
      </TransitionSeries.Sequence>,
    ])}
    {transition('transition-outro')}
    <TransitionSeries.Sequence durationInFrames={OUTRO_DURATION}>
      <Outro />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);
