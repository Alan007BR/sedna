// One short line of guidance above the sky during a mission. It never covers the frames.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { MISSIONS, type Mission, type MissionStep } from "./lib/missions";

type Props = {
  mission: Mission;
  step: number; // index of the current step; equal to steps.length when finished
  onAction: (patch: NonNullable<MissionStep["action"]>["patch"]) => void;
  onNext: (mission: Mission) => void;
  onExit: () => void;
};

export default function MissionCoach({ mission, step, onAction, onNext, onExit }: Props) {
  const index = MISSIONS.findIndex((m) => m.id === mission.id);
  const next = MISSIONS[index + 1];
  const done = step >= mission.steps.length;
  const current = mission.steps[Math.min(step, mission.steps.length - 1)];
  return (
    <section className="coach" aria-label={`Mission: ${mission.title}`}>
      <div className="coach-head">
        <span className="eyebrow">Mission {index + 1} of {MISSIONS.length}</span>
        <strong>{mission.title}</strong>
        <ol className="coach-dots" aria-label={`Step ${Math.min(step + 1, mission.steps.length)} of ${mission.steps.length}`}>
          {mission.steps.map((_, i) => (
            <li key={i} className={i < step ? "done" : i === step ? "now" : ""} />
          ))}
        </ol>
        <button type="button" className="text" onClick={onExit}>{done ? "Close" : "Exit mission"}</button>
      </div>
      <p className="coach-text" aria-live="polite">
        {done ? mission.finale : current.text}
      </p>
      <div className="focus-actions">
        {!done && current.action && (
          <button type="button" className="text ice" onClick={() => onAction(current.action!.patch)}>{current.action.label}</button>
        )}
        {done && next && <button type="button" className="primary" onClick={() => onNext(next)}>Next mission: {next.title}</button>}
        {done && <button type="button" className="text" onClick={onExit}>Explore on your own</button>}
      </div>
    </section>
  );
}
