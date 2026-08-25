import { Composition } from 'remotion';
import { ResolveRoomWalkthrough, WALKTHROUGH_DURATION } from './Walkthrough';

export const RemotionRoot = () => (
  <Composition
    id="ResolveRoomWalkthrough"
    component={ResolveRoomWalkthrough}
    durationInFrames={WALKTHROUGH_DURATION}
    fps={30}
    width={1920}
    height={1080}
  />
);
